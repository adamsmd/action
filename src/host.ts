import {promises as fs} from 'fs'
import * as process from 'process'
import * as os from 'os'

import * as exec from '@actions/exec'

import {execWithOutput} from './utility'
import path from 'path'

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

  abstract get workDirectory(): string
  abstract createDiskFile(size: string, diskPath: string): Promise<void>
  abstract createDiskDevice(diskPath: string): Promise<string>
  abstract partitionDisk(devicePath: string, mountName: string): Promise<void>
  abstract mountDisk(devicePath: string, mountPath: string): Promise<string>
  abstract detachDevice(devicePath: string): Promise<void>
}

class MacOs extends Host {
  get workDirectory(): string {
    return '/Users/runner/work'
  }

  async createDiskFile(size: string, diskPath: string): Promise<void> {
    await exec.exec('mkfile', ['-n', size, diskPath])
  }

  async createDiskDevice(diskPath: string): Promise<string> {
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

  async partitionDisk(devicePath: string, mountName: string): Promise<void> {
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

  async mountDisk(_devicePath: string, mountPath: string): Promise<string> {
    return path.join('/Volumes', path.basename(mountPath))
  }

  async detachDevice(devicePath: string): Promise<void> {
    await exec.exec('hdiutil', ['detach', devicePath])
  }
}

class Linux extends Host {
  get workDirectory(): string {
    return '/home/runner/work'
  }

  async createDiskFile(size: string, diskPath: string): Promise<void> {
    await exec.exec('truncate', ['-s', size, diskPath])
  }

  async createDiskDevice(diskPath: string): Promise<string> {
    const devicePath = await execWithOutput(
      'sudo',
      ['losetup', '-f', '--show', diskPath],
      {silent: true}
    )

    return devicePath.trim()
  }

  /* eslint-disable  @typescript-eslint/no-unused-vars */
  async partitionDisk(devicePath: string, _mountName: string): Promise<void> {
    /* eslint-enable  @typescript-eslint/no-unused-vars */
    await exec.exec('sudo', ['mkfs.msdos', devicePath])
  }

  async mountDisk(devicePath: string, mountPath: string): Promise<string> {
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

  async detachDevice(devicePath: string): Promise<void> {
    await exec.exec('sudo', ['losetup', '-d', devicePath])
  }
}
