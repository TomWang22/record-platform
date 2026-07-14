/**
 * Phase 32H — bounded Worker pool with mandatory listener/port cleanup.
 */
import { Worker } from 'node:worker_threads';

export const WORKER_POOL_FULL = 'WORKER_POOL_FULL';
export const DEFAULT_WORKER_POOL_SIZE = 3;

/**
 * Cap captured child process output.
 */
export function capBuffer(buf, maxBytes, label = 'stdout') {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf ?? ''), 'utf8');
  if (b.length > maxBytes) {
    const err = new Error(`${label} exceeded cap of ${maxBytes} bytes (got ${b.length})`);
    err.code = 'CHILD_OUTPUT_CAP';
    throw err;
  }
  return b;
}

export class BoundedWorkerPool {
  /**
   * @param {{ workerScript: string, size?: number, workerData?: object, maxQueue?: number }} opts
   */
  constructor({ workerScript, size = DEFAULT_WORKER_POOL_SIZE, workerData = {}, maxQueue = 64 }) {
    this.workerScript = workerScript;
    this.size = Math.max(1, Number(size) || DEFAULT_WORKER_POOL_SIZE);
    this.maxQueue = Math.max(1, Number(maxQueue) || 64);
    this.baseWorkerData = workerData;
    /** @type {import('node:worker_threads').Worker[]} */
    this.idle = [];
    /** @type {Set<import('node:worker_threads').Worker>} */
    this.busy = new Set();
    /** @type {{ payload: any, resolve: Function, reject: Function }[]} */
    this.waiters = [];
    this.terminated = false;
    this.stats = {
      created: 0,
      jobs: 0,
      recycled: 0,
      replaced: 0,
      peakBusy: 0,
      peakQueue: 0,
    };
    for (let i = 0; i < this.size; i += 1) {
      this.#spawnIntoIdle();
    }
  }

  get workerCount() {
    return this.idle.length + this.busy.size;
  }

  get busyCount() {
    return this.busy.size;
  }

  get queueDepth() {
    return this.waiters.length;
  }

  #spawnIntoIdle() {
    if (this.terminated) return null;
    if (this.workerCount >= this.size) return null;
    const worker = new Worker(this.workerScript, {
      workerData: { ...this.baseWorkerData, pool: true },
    });
    this.stats.created += 1;
    this.idle.push(worker);
    return worker;
  }

  /**
   * Run one job. Rejects if pool is full and waiter queue exceeds maxQueue.
   */
  runJob(payload) {
    if (this.terminated) {
      return Promise.reject(new Error('worker pool terminated'));
    }
    if (this.idle.length > 0) {
      const worker = this.idle.pop();
      return this.#runOnWorker(worker, payload);
    }
    if (this.waiters.length >= this.maxQueue) {
      const err = new Error(`worker pool queue full (maxQueue=${this.maxQueue})`);
      err.code = WORKER_POOL_FULL;
      return Promise.reject(err);
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ payload, resolve, reject });
      this.stats.peakQueue = Math.max(this.stats.peakQueue, this.waiters.length);
    });
  }

  #runOnWorker(worker, payload) {
    return new Promise((resolve, reject) => {
      this.busy.add(worker);
      this.stats.jobs += 1;
      this.stats.peakBusy = Math.max(this.stats.peakBusy, this.busy.size);

      const onMessage = (msg) => {
        finish(null, msg);
      };
      const onError = (err) => {
        finish(err, null);
      };
      const onExit = (code) => {
        if (this.busy.has(worker)) {
          finish(new Error(`probe worker exited ${code}`), null);
        }
      };

      let settled = false;
      const finish = async (err, msg) => {
        if (settled) return;
        settled = true;
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
        this.busy.delete(worker);

        if (err || (msg && msg.ok === false)) {
          const failure = err || new Error(msg?.error || 'probe worker failed');
          try {
            await worker.terminate();
          } catch {
            // ignore
          }
          this.stats.replaced += 1;
          if (!this.terminated) this.#spawnIntoIdle();
          this.#pump();
          reject(failure);
          return;
        }

        this.stats.recycled += 1;
        if (!this.terminated) {
          if (this.waiters.length) {
            const next = this.waiters.shift();
            this.#runOnWorker(worker, next.payload).then(next.resolve, next.reject);
          } else {
            this.idle.push(worker);
          }
        } else {
          try {
            await worker.terminate();
          } catch {
            // ignore
          }
        }
        resolve(msg);
      };

      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.on('exit', onExit);
      worker.postMessage({ type: 'job', payload });
    });
  }

  #pump() {
    while (this.idle.length && this.waiters.length) {
      const worker = this.idle.pop();
      const next = this.waiters.shift();
      this.#runOnWorker(worker, next.payload).then(next.resolve, next.reject);
    }
  }

  async close() {
    this.terminated = true;
    const pending = this.waiters.splice(0);
    for (const w of pending) w.reject(new Error('worker pool terminated'));
    const all = [...this.idle, ...this.busy];
    this.idle = [];
    this.busy.clear();
    await Promise.all(
      all.map(async (worker) => {
        try {
          worker.removeAllListeners();
          await worker.terminate();
        } catch {
          // ignore
        }
      }),
    );
  }
}
