import { sqlite } from "../db/index.ts";

type Job = () => void;

/**
 * 单写队列：高频写入（entries/steps/events）批量事务落库（md/02 §4）。
 * better-sqlite3 同步 API，flush 在事件循环内完成。
 */
class WriteQueue {
  private jobs: Job[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  push(job: Job): void {
    this.jobs.push(job);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 50);
  }

  flush(): void {
    if (this.flushing) return;
    this.flushing = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const pending = this.jobs;
    this.jobs = [];
    try {
      sqlite.transaction(() => {
        for (const job of pending) job();
      })();
    } catch (err) {
      console.error("[write-queue] 批量写入失败:", err);
    } finally {
      this.flushing = false;
      if (this.jobs.length) this.timer = setTimeout(() => this.flush(), 50);
    }
  }
}

export const writeQueue = new WriteQueue();
