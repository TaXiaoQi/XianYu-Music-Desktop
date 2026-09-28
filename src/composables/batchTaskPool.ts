/** 单个批量任务单元：resolve 为 true 视作成功 */
export type BatchTaskUnit = () => Promise<boolean>;

/**
 * 以"接力认领"方式并发消化任务队列：
 * 每条通道完成手头任务后立刻认领下一条，直到队列排空。
 * 返回成功的任务数量。
 */
export async function runBatchTaskPool(
  tasks: readonly BatchTaskUnit[],
  laneLimit: number,
): Promise<number> {
  const outcomes: boolean[] = new Array(tasks.length).fill(false);
  let nextClaim = 0;

  const claimAndRun = async (): Promise<void> => {
    if (nextClaim >= tasks.length) {
      return;
    }
    const slot = nextClaim;
    nextClaim += 1;
    outcomes[slot] = await tasks[slot]();
    await claimAndRun();
  };

  await Promise.all(
    Array.from({ length: Math.min(laneLimit, tasks.length) }, () => claimAndRun()),
  );

  return outcomes.reduce((total, ok) => (ok ? total + 1 : total), 0);
}
