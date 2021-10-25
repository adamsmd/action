import {promises as fs} from 'fs'
import path from 'path'
import * as process from 'process'
import * as os from 'os'

import * as core from '@actions/core'
import * as exec from '@actions/exec'

import {execWithOutput} from './utility'
import * as vm from './vm'

export enum Kind {
  darwin,
  linux
}

export const kind = toKind(process.platform)

function toKind(value: string): Kind {
  switch (value) {
    case 'darwin':
      return Kind.darwin
    case 'linux':
      return Kind.linux
    default:
      throw Error(`Unhandled host platform: ${value}`)
  }
}

export function toString(value: Kind): string {
  switch (value) {
    case Kind.darwin:
      return 'macos'
    case Kind.linux:
      return 'linux'
    default:
      throw Error(`Unhandled host platform: ${value}`)
  }
}

export abstract class Host {
  static create(): Host {
    switch (kind) {
      case Kind.darwin:
        return new MacOs()
      case Kind.linux:
        return new Linux()
      default:
        throw Error(`Unhandled host platform: ${kind}`)
    }
  }

  abstract get accelerator(): vm.Accelerator
  abstract get workDirectory(): string

  abstract createDisk(
    size: string,
    diskPath: string,
    requestedMountPath: string,
    block: (mountPath: Promise<string>) => void
  ): Promise<void>
}

class MacOs extends Host {
  get accelerator(): vm.Accelerator {
    return vm.Accelerator.hvf
  }

  get workDirectory(): string {
    return '/Users/runner/work'
  }

  async createDisk(
    size: string,
    diskPath: string,
    requestedMountPath: string,
    block: (mountPath: Promise<string>) => void
  ): Promise<void> {
    await this.createDiskFile(size, diskPath)

    let devicePath: string | undefined
    let mountPath: Promise<string> | undefined

    try {
      devicePath = await this.createDiskDevice(diskPath)
      await this.partitionDisk(devicePath, requestedMountPath)
      mountPath = this.getFullMountPath(requestedMountPath)
      block(mountPath)
    } finally {
      if (mountPath) this.unmount(await mountPath)
      if (devicePath) this.detachDevice(devicePath)
    }
  }

  private async createDiskFile(size: string, diskPath: string): Promise<void> {
    core.debug('Creating disk file')
    await exec.exec('mkfile', ['-n', size, diskPath])
  }

  private async createDiskDevice(diskPath: string): Promise<string> {
    core.debug('Creating disk device')
    const devicePath = await execWithOutput(
      'hdiutil',
      [
        'attach',
        '-imagekey',
        'diskimage-class=CRawDiskImage',
        '-nomount',
        diskPath
      ],
      {silent: true}
    )

    return devicePath.trim()
  }

  private async partitionDisk(
    devicePath: string,
    mountName: string
  ): Promise<void> {
    await exec.exec('diskutil', [
      'partitionDisk',
      devicePath,
      '1',
      'GPT',
      'fat32',
      mountName,
      '100%'
    ])
  }

  private async getFullMountPath(mountPath: string): Promise<string> {
    core.debug('Getting full mount path')
    return path.join('/Volumes', path.basename(mountPath))
  }

  private async unmount(mountPath: string): Promise<void> {
    core.debug('Unmounting disk')
    await exec.exec('sudo', ['umount', mountPath])
  }

  private async detachDevice(devicePath: string): Promise<void> {
    core.debug('Detaching device')
    await exec.exec('hdiutil', ['detach', devicePath])
  }
}

class Linux extends Host {
  get accelerator(): vm.Accelerator {
    return vm.Accelerator.tcg
  }

  get workDirectory(): string {
    return '/home/runner/work'
  }

  async createDisk(
    size: string,
    diskPath: string,
    requestedMountPath: string,
    block: (mountPath: Promise<string>) => void
  ): Promise<void> {
    await this.createDiskFile(size, diskPath)

    let devicePath: string | undefined
    let mountPath: Promise<string> | undefined

    try {
      devicePath = await this.createDiskDevice(diskPath)
      await this.partitionDisk(devicePath)
      mountPath = this.mountDisk(devicePath, requestedMountPath)
      block(mountPath)
    } finally {
      if (mountPath) this.unmount(await mountPath)
      if (devicePath) this.detachDevice(devicePath)
    }
  }

  private async createDiskFile(size: string, diskPath: string): Promise<void> {
    core.debug('Creating disk file')
    await exec.exec('truncate', ['-s', size, diskPath])
  }

  private async createDiskDevice(diskPath: string): Promise<string> {
    core.debug('Creating disk device')
    const devicePath = await execWithOutput(
      'sudo',
      ['losetup', '-f', '--show', diskPath],
      {silent: true}
    )

    return devicePath.trim()
  }

  private async partitionDisk(devicePath: string): Promise<void> {
    await exec.exec('sudo', ['mkfs.msdos', devicePath])
  }

  private async mountDisk(
    devicePath: string,
    mountPath: string
  ): Promise<string> {
    core.debug('Mounting disk')
    await fs.mkdir(mountPath, {recursive: true})
    const uid = os.userInfo().uid
    await exec.exec('sudo', [
      'mount',
      '-o',
      `uid=${uid}`,
      devicePath,
      mountPath
    ])

    return mountPath
  }

  private async unmount(mountPath: string): Promise<void> {
    core.debug('Unmounting disk')
    await exec.exec('sudo', ['umount', mountPath])
  }

  private async detachDevice(devicePath: string): Promise<void> {
    await exec.exec('sudo', ['losetup', '-d', devicePath])
  }
}

export const host = Host.create()
