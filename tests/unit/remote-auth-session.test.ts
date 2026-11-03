/**
 * OAuth 인증 세션 테스트 (INT-006 T-04, AC-6·AC-7·AC-16).
 * 가짜 rc 세션·프로세스로 질문 흐름·자동 답(config_is_local)·취소 정리·재인증을 확인한다.
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import type { clsRcSession } from "@/main/rclone/rc-session";
import { clsRemoteAuthSession } from "@/main/services/remote-auth-session";
import type { itfRemoteAuthProgress } from "@/shared/types/remote-config";

const LOGGER = { info: () => undefined, warn: () => undefined };

function f_FakeSession(responses: unknown[]) {
    const posts: Array<{ path: string; body: unknown }> = [];
    let quitCount = 0;
    let aborted = false;
    const session = {
        post: async (path: string, body: unknown) => {
            posts.push({ path, body });
            return responses.shift() ?? {};
        },
        quit: async () => {
            quitCount += 1;
        },
        abort: () => {
            aborted = true;
        },
    } as unknown as clsRcSession;
    return {
        session,
        posts,
        quitCount: () => quitCount,
        aborted: () => aborted,
    };
}

function f_Collector() {
    const events: itfRemoteAuthProgress[] = [];
    let notify: (() => void) | null = null;
    const emit = (e: itfRemoteAuthProgress) => {
        events.push(e);
        notify?.();
        notify = null;
    };
    const next = async (predicate: (e: itfRemoteAuthProgress) => boolean) => {
        for (;;) {
            const hit = events.find(predicate);
            if (hit) return hit;
            await new Promise<void>((resolve) => {
                notify = resolve;
            });
        }
    };
    return { events, emit, next };
}

function f_Question(name: string, extra: Record<string, unknown> = {}) {
    return {
        State: name === "config_is_local" ? "*oauth-islocal,teamdrive,oauth," : "state-" + name,
        Option: {
            Name: name,
            Help: "질문",
            Type: "string",
            DefaultStr: "",
            Required: false,
            Advanced: false,
            IsPassword: false,
            Sensitive: false,
            Exclusive: false,
            Hide: 0,
            ...extra,
        },
        Error: "",
        Result: "",
    };
}

function f_Session(
    fake: ReturnType<typeof f_FakeSession>,
    collector: ReturnType<typeof f_Collector>,
    over: { cleanup?: () => Promise<void>; refresh?: () => Promise<void> } = {},
) {
    return new clsRemoteAuthSession({
        name: "it-drive",
        type: "drive",
        mode: "create",
        binaryPath: "C:\\fake\\rclone.exe",
        configPath: "C:\\fake\\rclone.conf",
        parameters: {},
        emit: collector.emit,
        cleanup: over.cleanup ?? (async () => undefined),
        refresh: over.refresh ?? (async () => undefined),
        logger: LOGGER,
        sessionFactory: async () => fake.session,
    });
}

describe("clsRemoteAuthSession (create)", () => {
    it("질문을 화면에 알리고 답을 opt.continue로 보낸다 (AC-16)", async () => {
        const fake = f_FakeSession([
            f_Question("config_shared_client_id", {
                Type: "bool",
                DefaultStr: "false",
                Exclusive: true,
            }),
            f_Question("client_id"),
            {},
        ]);
        const c = f_Collector();
        const session = f_Session(fake, c);
        session.start();

        const first = await c.next((e) => e.phase === "question");
        expect(first.question?.option?.name).toBe("config_shared_client_id");
        const next = await session.answer(first.question!.state, "false");
        expect(next.phase).toBe("question");
        expect(next.question?.option?.name).toBe("client_id");
        const done = await session.answer(next.question!.state, "my-client-id");
        expect(done.phase).toBe("done");
        await session.done;

        expect(fake.posts[1]!.body).toMatchObject({
            opt: { continue: true, state: "state-config_shared_client_id", result: "false" },
        });
        expect(fake.posts[2]!.body).toMatchObject({ opt: { result: "my-client-id" } });
        expect(fake.quitCount()).toBe(1);
    });

    it("config_is_local은 앱이 자동으로 true로 답한다", async () => {
        const fake = f_FakeSession([f_Question("config_is_local"), {}]);
        const c = f_Collector();
        const session = f_Session(fake, c);
        session.start();
        await session.done;
        expect(c.events.some((e) => e.phase === "question")).toBe(false);
        expect(fake.posts[1]!.body).toMatchObject({ opt: { result: "true" } });
    });

    it("취소하면 프로세스를 멈추고 이번에 만든 remote를 지운다 (AC-6)", async () => {
        const fake = f_FakeSession([f_Question("client_id")]);
        const c = f_Collector();
        let cleaned = 0;
        const session = f_Session(fake, c, {
            cleanup: async () => {
                cleaned += 1;
            },
        });
        session.start();
        await c.next((e) => e.phase === "question");
        await session.cancel("canceled", "사용자가 취소");
        expect(cleaned).toBe(1);
        expect(fake.aborted()).toBe(true);
        expect(c.events.at(-1)?.phase).toBe("canceled");
        expect((await session.done).phase).toBe("canceled");
    });

    it("실패하면 실패를 알리고 이번에 만든 remote를 지운다", async () => {
        const fake = f_FakeSession([{ State: "", Option: null, Error: "boom", Result: "" }]);
        const c = f_Collector();
        let cleaned = 0;
        const session = f_Session(fake, c, {
            cleanup: async () => {
                cleaned += 1;
            },
        });
        session.start();
        const done = await session.done;
        expect(done.phase).toBe("failed");
        expect(done.message).toContain("boom");
        expect(cleaned).toBe(1);
    });
});

function f_Child() {
    const child = new EventEmitter() as EventEmitter & {
        pid: number;
        exitCode: number | null;
        stderr: PassThrough;
        stdout: PassThrough;
    };
    child.pid = 4242;
    child.exitCode = null;
    child.stderr = new PassThrough();
    child.stdout = new PassThrough();
    return child;
}

describe("clsRemoteAuthSession (reconnect)", () => {
    it("인증 주소를 알리고 성공하면 환경을 다시 감지한다 (AC-7)", async () => {
        const child = f_Child();
        const c = f_Collector();
        let refreshed = 0;
        const session = new clsRemoteAuthSession({
            name: "it-drive",
            type: "drive",
            mode: "reconnect",
            binaryPath: "C:\\fake\\rclone.exe",
            configPath: "C:\\fake\\rclone.conf",
            parameters: {},
            emit: c.emit,
            cleanup: async () => undefined,
            refresh: async () => {
                refreshed += 1;
            },
            logger: LOGGER,
            spawnReconnect: () => {
                setTimeout(() => {
                    child.stderr.write(
                        "NOTICE: If your browser doesn't open automatically go to the following link: http://127.0.0.1:53682/auth?state=abc\n",
                    );
                    child.exitCode = 0;
                    child.emit("close", 0);
                }, 0);
                return child as never;
            },
        });
        session.start();
        await session.done;
        expect(c.events.some((e) => e.phase === "waiting" && e.authUrl?.includes("/auth?"))).toBe(
            true,
        );
        expect(refreshed).toBe(1);
        expect(c.events.at(-1)?.phase).toBe("done");
    });

    it("실패하면 기존 설정을 그대로 두라고 알린다", async () => {
        const child = f_Child();
        const c = f_Collector();
        const session = new clsRemoteAuthSession({
            name: "it-drive",
            type: "drive",
            mode: "reconnect",
            binaryPath: "C:\\fake\\rclone.exe",
            configPath: "C:\\fake\\rclone.conf",
            parameters: {},
            emit: c.emit,
            cleanup: async () => undefined,
            refresh: async () => undefined,
            logger: LOGGER,
            spawnReconnect: () => {
                setTimeout(() => {
                    child.exitCode = 1;
                    child.emit("close", 1);
                }, 0);
                return child as never;
            },
        });
        session.start();
        const done = await session.done;
        expect(done.phase).toBe("failed");
        expect(done.message).toContain("기존 설정은 바뀌지 않았습니다");
    });
});
