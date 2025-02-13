
import { performance } from 'perf_hooks';

export class Timer {
    constructor() {
        this.startTime = 0;
        this.endTime = 0;
    }

    start() {
        this.startTime = performance.now();
    }

    stop() {
        this.endTime = performance.now();
        const timeElapsed = ((this.endTime - this.startTime) / 1000).toFixed(2);
        return timeElapsed + 's';
    }

    reset() {
        this.startTime = 0;
        this.endTime = 0;
    }
}