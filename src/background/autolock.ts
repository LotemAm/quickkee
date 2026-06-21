export class AutoLock {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hours = 0;
  constructor(private onLock: () => void) {}
  arm(hours: number) { this.hours = hours; this.schedule(); }
  touch() { if (this.timer) this.schedule(); }
  disarm() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.onLock(); }, this.hours * 3600 * 1000);
  }
}
