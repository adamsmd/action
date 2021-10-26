import * as fs from 'fs'
import * as path from 'path'

import * as core from '@actions/core'
import * as exec from '@actions/exec'

import * as action from './action'
import * as architecture from './architecture'
import * as host from './host'
import * as qemu from './qemu_vm'
import * as vmModule from './vm'
import * as xhyve from './xhyve_vm'

export const resourceBaseUrl =
  'https://github.com/cross-platform-actions/resources/releases/download/'

export enum Kind {
  freeBsd,
  netBsd,
  openBsd
}

const stringToKind: ReadonlyMap<string, Kind> = (() => {
  const map = new Map<string, Kind>()
  map.set('freebsd', Kind.freeBsd)
  map.set('netbsd', Kind.netBsd)
  map.set('openbsd', Kind.openBsd)
  return map
})()

export function toKind(value: string): Kind | undefined {
  return stringToKind.get(value.toLowerCase())
}

export abstract class OperatingSystem {
  readonly resourcesUrl: string
  private static readonly baseUrl = 'https://github.com/cross-platform-actions'

  readonly architecture: architecture.Architecture

  private readonly name: string
  private readonly version: string

  constructor(name: string, arch: architecture.Architecture, version: string) {
    const hostString = host.toString(host.kind)
    this.resourcesUrl = `${resourceBaseUrl}v0.3.0/resources-${hostString}.tar`
    this.name = name
    this.version = version
    this.architecture = arch
  }

  static create(
    operatingSystemKind: Kind,
    architectureKind: architecture.Kind,
    version: string
  ): OperatingSystem {
    const arch = architecture.getArchitecture(architectureKind)

    switch (operatingSystemKind) {
      case Kind.freeBsd:
        return new FreeBsd(arch, version)
      case Kind.netBsd:
        return new NetBsd(arch, version)
      case Kind.openBsd:
        return new OpenBsd(arch, version)
    }
  }

  abstract get virtualMachineImageReleaseVersion(): string
  abstract get hypervisorUrl(): string
  abstract get ssHostPort(): number
  abstract get actionImplementationKind(): action.ImplementationKind

  get virtualMachineImageUrl(): string {
    return [
      OperatingSystem.baseUrl,
      `${this.name}-builder`,
      'releases',
      'download',
      this.virtualMachineImageReleaseVersion,
      this.imageName
    ].join('/')
  }

  abstract createVirtualMachine(
    hypervisorDirectory: fs.PathLike,
    resourcesDirectory: fs.PathLike,
    configuration: vmModule.Configuration
  ): vmModule.Vm

  abstract prepareDisk(
    diskImage: fs.PathLike,
    targetDiskName: fs.PathLike,
    resourcesDirectory: fs.PathLike
  ): Promise<void>

  async setupWorkDirectory(
    vm: vmModule.Vm,
    workDirectory: string
  ): Promise<void> {
    const destination = `/home/${vmModule.Vm.user}/work`

    if (workDirectory === destination)
      await vm.execute(`rm -rf '${destination}' && mkdir -p '${workDirectory}'`)
    else {
      await vm.execute(
        `rm -rf '${destination}' && mkdir -p '${workDirectory}' && ln -sf '${workDirectory}/' '${destination}'`
      )
    }
  }

  private get imageName(): string {
    const encodedVersion = encodeURIComponent(this.version)
    const archString = architecture.toString(this.architecture.kind)
    return `${this.name}-${encodedVersion}-${archString}.qcow2`
  }
}

class FreeBsd extends OperatingSystem {
  constructor(arch: architecture.Architecture, version: string) {
    super('freebsd', arch, version)
  }

  get hypervisorUrl(): string {
    if (this.architecture.kind === architecture.Kind.x86_64)
      return xhyve.Vm.hypervisorUrl
    else return this.architecture.resourceUrl
  }

  get ssHostPort(): number {
    if (this.architecture.kind === architecture.Kind.x86_64)
      return xhyve.Vm.sshPort
    else return qemu.Vm.sshPort
  }

  get actionImplementationKind(): action.ImplementationKind {
    if (this.architecture.kind === architecture.Kind.x86_64)
      return action.ImplementationKind.xhyve
    else return action.ImplementationKind.qemu
  }

  override async prepareDisk(
    diskImage: fs.PathLike,
    targetDiskName: fs.PathLike,
    resourcesDirectory: fs.PathLike
  ): Promise<void> {
    await convertToRawDisk(diskImage, targetDiskName, resourcesDirectory)
  }

  get virtualMachineImageReleaseVersion(): string {
    return 'v0.2.0'
  }

  createVirtualMachine(
    hypervisorDirectory: fs.PathLike,
    resourcesDirectory: fs.PathLike,
    configuration: vmModule.Configuration
  ): vmModule.Vm {
    core.debug('Creating FreeBSD VM')

    if (this.architecture.kind === architecture.Kind.x86_64) {
      return new host.host.vmModule.FreeBsd(
        hypervisorDirectory,
        resourcesDirectory,
        configuration
      )
    } else {
      throw Error(
        `Not implemented: FreeBSD guests are not implemented on ${architecture.toString(
          this.architecture.kind
        )}`
      )
    }
  }
}

class NetBsd extends OperatingSystem {
  constructor(arch: architecture.Architecture, version: string) {
    super('netbsd', arch, version)
  }

  get ssHostPort(): number {
    return qemu.Vm.sshPort
  }

  get hypervisorUrl(): string {
    return this.architecture.resourceUrl
  }

  get virtualMachineImageReleaseVersion(): string {
    return 'v0.0.1-rc6'
  }

  get actionImplementationKind(): action.ImplementationKind {
    return action.ImplementationKind.qemu
  }

  override async prepareDisk(
    diskImage: fs.PathLike,
    targetDiskName: fs.PathLike,
    resourcesDirectory: fs.PathLike
  ): Promise<void> {
    await convertToRawDisk(diskImage, targetDiskName, resourcesDirectory)
  }

  createVirtualMachine(
    hypervisorDirectory: fs.PathLike,
    resourcesDirectory: fs.PathLike,
    configuration: vmModule.Configuration
  ): vmModule.Vm {
    core.debug('Creating NetBSD VM')

    return new qemu.NetBsd(
      hypervisorDirectory,
      resourcesDirectory,
      configuration
    )
  }
}

class OpenBsd extends OperatingSystem {
  constructor(arch: architecture.Architecture, version: string) {
    super('openbsd', arch, version)
  }

  get hypervisorUrl(): string {
    if (this.architecture.kind === architecture.Kind.x86_64)
      return xhyve.Vm.hypervisorUrl
    else return this.architecture.resourceUrl
  }

  get ssHostPort(): number {
    if (this.architecture.kind === architecture.Kind.x86_64)
      return xhyve.Vm.sshPort
    else return qemu.Vm.sshPort
  }

  get actionImplementationKind(): action.ImplementationKind {
    if (this.architecture.kind === architecture.Kind.x86_64)
      return action.ImplementationKind.xhyve
    else return action.ImplementationKind.qemu
  }

  override async prepareDisk(
    diskImage: fs.PathLike,
    targetDiskName: fs.PathLike,
    resourcesDirectory: fs.PathLike
  ): Promise<void> {
    await convertToRawDisk(diskImage, targetDiskName, resourcesDirectory)
  }

  get virtualMachineImageReleaseVersion(): string {
    return 'v0.2.0'
  }

  createVirtualMachine(
    hypervisorDirectory: fs.PathLike,
    resourcesDirectory: fs.PathLike,
    configuration: vmModule.Configuration
  ): vmModule.Vm {
    core.debug('Creating OpenBSD VM')

    if (this.architecture.kind === architecture.Kind.x86_64) {
      return new host.host.vmModule.OpenBsd(
        hypervisorDirectory,
        resourcesDirectory,
        configuration
      )
    } else {
      throw Error(
        `Not implemented: OpenBSD guests are not implemented on ${architecture.toString(
          this.architecture.kind
        )}`
      )
    }
  }
}

async function convertToRawDisk(
  diskImage: fs.PathLike,
  targetDiskName: fs.PathLike,
  resourcesDirectory: fs.PathLike
): Promise<void> {
  core.debug('Converting qcow2 image to raw')
  const resDir = resourcesDirectory.toString()
  await exec.exec(path.join(resDir, 'qemu-img'), [
    'convert',
    '-f',
    'qcow2',
    '-O',
    'raw',
    diskImage.toString(),
    path.join(resDir, targetDiskName.toString())
  ])
}
