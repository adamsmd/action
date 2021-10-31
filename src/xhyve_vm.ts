import * as fs from 'fs'

import * as core from '@actions/core'

import {execWithOutput} from './utility'
import {wait} from './wait'
import * as vm from './vm'

export abstract class Vm extends vm.Vm {
  static readonly sshPort = 22
  macAddress!: string

  constructor(
    hypervisorDirectory: fs.PathLike,
    resourcesDirectory: fs.PathLike,
    configuration: vm.Configuration
  ) {
    super(hypervisorDirectory, resourcesDirectory, 'xhyve', configuration)
  }

  override async init(): Promise<void> {
    super.init()
    this.macAddress = await this.getMacAddress()
  }

  protected abstract get networkDevice(): string

  protected override async getIpAddress(): Promise<string> {
    return getIpAddressFromArp(this.macAddress)
  }

  protected get command(): string[] {
    const config = this.configuration

    // prettier-ignore
    return [
        this.hypervisorPath.toString(),
        '-U', config.uuid,
        '-A',
        '-H',
        '-m', config.memory,
        '-c', config.cpuCount.toString(),
        '-s', '0:0,hostbridge',
        '-s', `2:0,${this.networkDevice}`,
        '-s', `4:0,virtio-blk,${config.diskImage}`,
        '-s', `4:1,virtio-blk,${config.resourcesDiskImage}`,
        '-s', '31,lpc',
        '-l', 'com1,stdio'
      ]
  }

  private async getMacAddress(): Promise<string> {
    core.debug('Getting MAC address')
    this.macAddress = (
      await execWithOutput('sudo', this.command.concat('-M'), {
        silent: !core.isDebug()
      })
    )
      .trim()
      .slice(5)
    core.debug(`Found MAC address: '${this.macAddress}'`)
    return this.macAddress
  }
}

export function extractIpAddress(
  arpOutput: string,
  macAddress: string
): string | undefined {
  core.debug('Extracing IP address')
  const matchResult = arpOutput
    .split('\n')
    .find(e => e.includes(macAddress))
    ?.match(/\((.+)\)/)

  const ipAddress = matchResult ? matchResult[1] : undefined

  if (ipAddress !== undefined) core.info(`Found IP address: '${ipAddress}'`)

  return ipAddress
}

export class FreeBsd extends Vm {
  override get command(): string[] {
    // prettier-ignore
    return super.command.concat(
      '-f', `fbsd,${this.configuration.userboot},${this.configuration.diskImage},`
    )
  }

  protected get networkDevice(): string {
    return 'virtio-net'
  }

  protected override async shutdown(): Promise<void> {
    await this.execute('sudo shutdown -p now')
  }
}

export class OpenBsd extends Vm {
  override get command(): string[] {
    // prettier-ignore
    return super.command.concat(
      '-l', `bootrom,${this.configuration.firmware}`,
      '-w'
    )
  }

  protected get networkDevice(): string {
    return 'e1000'
  }

  protected override async shutdown(): Promise<void> {
    await this.execute('sudo shutdown -h -p now')
  }
}

async function getIpAddressFromArp(macAddress: string): Promise<string> {
  core.info(`Getting IP address for MAC address: ${macAddress}`)
  for (let i = 0; i < 500; i++) {
    core.info('Waiting for IP to become available...')
    const arpOutput = await execWithOutput('arp', ['-a', '-n'], {silent: true})
    const ipAddress = extractIpAddress(arpOutput, macAddress)

    if (ipAddress !== undefined) return ipAddress

    await wait(1_000)
  }

  throw Error(`Failed to get IP address for MAC address: ${macAddress}`)
}
