import { bestzip } from 'bestzip';
import * as childProcess from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { join } from 'ramda';
import { IFiles, IFile } from './types';

export class SpawnError extends Error {
  constructor(message: string, public stdout: string, public stderr: string) {
    super(message);
  }

  toString() {
    return `${this.message}\n${this.stderr}`;
  }
}

/**
 * Executes a child process without limitations on stdout and stderr.
 * On error (exit code is not 0), it rejects with a SpawnProcessError that contains the stdout and stderr streams,
 * on success it returns the streams in an object.
 * @param {string} command - Command
 * @param {string[]} [args] - Arguments
 * @param {Object} [options] - Options for child_process.spawn
 */
export function spawnProcess(
  command: string,
  args: string[],
  options: childProcess.SpawnOptionsWithoutStdio
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = childProcess.spawn(command, args, options);
    let stdout = '';
    let stderr = '';
    // Configure stream encodings
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    // Listen to stream events
    child.stdout.on('data', data => {
      stdout += data;
    });
    child.stderr.on('data', data => {
      stderr += data;
    });
    child.on('error', err => {
      reject(err);
    });
    child.on('close', exitCode => {
      if (exitCode !== 0) {
        reject(
          new SpawnError(
            `${command} ${join(' ', args)} failed with code ${exitCode}`,
            stdout,
            stderr
          )
        );
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Find a file by walking up parent directories
 */
export function findUp(name: string, directory: string = process.cwd()): string | undefined {
  const absoluteDirectory = path.resolve(directory);

  if (fs.existsSync(path.join(directory, name))) {
    return directory;
  }

  const { root } = path.parse(absoluteDirectory);
  if (absoluteDirectory === root) {
    return undefined;
  }

  return findUp(name, path.dirname(absoluteDirectory));
}

/**
 * Forwards `rootDir` or finds project root folder.
 */
export function findProjectRoot(rootDir?: string): string | undefined {
  return rootDir ?? findUp('yarn.lock') ?? findUp('package-lock.json') ?? findUp('package.json');
}

export const humanSize = (size: number) => {
  const i = Math.floor(Math.log(size) / Math.log(1024));
  const sanitized = (size / Math.pow(1024, i)).toFixed(2);
  return `${sanitized} ${['B', 'KB', 'MB', 'GB', 'TB'][i]}`;
};

export const zip = async (zipPath: string, filesPathList: IFiles) => {
  // create a temporary directory to hold the final zip structure
  const tempDirName = `${path.basename(zipPath).slice(0, -4)}-${Date.now().toString()}`;
  const tempDirPath = path.join(os.tmpdir(), tempDirName);
  fs.mkdirpSync(tempDirPath);

  // copy all required files from origin path to (sometimes modified) target path
  await Promise.all(
    filesPathList.map(
      file =>
        new Promise(resolve => {
          const destPath = path.join(tempDirPath, file.localPath);
          fs.copySync(file.rootPath, destPath);
          resolve(true);
        })
    )
  );

  // prepare zip folder
  fs.mkdirpSync(path.dirname(zipPath));

  // zip the temporary directory
  const result = await bestzip({
    source: '*',
    destination: zipPath,
    cwd: tempDirPath,
  });

  // delete the temporary folder
  fs.rmdirSync(tempDirPath, { recursive: true });

  return result;
};

export function trimExtension(entry: string) {
  return entry.slice(0, -path.extname(entry).length);
}
