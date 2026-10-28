/**
 * 비동기 작업을 한 번에 하나씩 실행하는 잠금. 저장소 쓰기를 직렬화해 lost update를 막는다.
 *
 * @author dev-Joy 2026-10-28
 */

export class clsMutex {
    private tail: Promise<unknown> = Promise.resolve();

    runExclusive<T>(task: () => Promise<T> | T): Promise<T> {
        const run = this.tail.then(task, task);
        this.tail = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }
}
