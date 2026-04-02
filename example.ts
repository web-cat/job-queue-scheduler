interface Job {
    id: string;
    arrivalTime: number; // Timestamp
    serviceTime: number; // Estimated Run Time
  }
  
  class HRRNScheduler {
    private queue: Job[] = [];
  
    addJob(job: Job) {
      this.queue.push(job);
    }
  
    getNextJob(): Job | undefined {
      if (this.queue.length === 0) return undefined;
  
      const now = Date.now();
      let highestRatio = -1;
      let bestJobIndex = -1;
  
      // O(N) Scan - faster than re-sorting a Heap for this specific formula
      for (let i = 0; i < this.queue.length; i++) {
        const job = this.queue[i];
        const waitingTime = (now - job.arrivalTime) / 1000; // in seconds
        
        // R = (W + S) / S
        const ratio = (waitingTime + job.serviceTime) / job.serviceTime;
  
        if (ratio > highestRatio) {
          highestRatio = ratio;
          bestJobIndex = i;
        }
      }
  
      if (bestJobIndex !== -1) {
        const [bestJob] = this.queue.splice(bestJobIndex, 1);
        return bestJob;
      }
    }
  }
  