/**
 * `rclone config providers` JSON과 rc 질문 Option을 화면용 정의로 바꾼다 (INT-006 T-02, FR-2·FR-15a).
 * - 모르는 필드는 무시하고, 필수 필드(Prefix·Name)가 없는 종류는 그 종류만 뺀다(E-10).
 * - Hide가 0이 아닌 옵션은 폼에 넣지 않는다.
 * - 비밀 판정은 IsPassword || Sensitive(notes #40·#43). OAuth 판정은 options에 token이 있는지다.
 * - 선택지는 Exclusive일 때만 고르기로 쓴다(그 밖의 Examples는 예시일 뿐이다).
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import { z } from "zod";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import type {
    itfRemoteOption,
    itfRemoteOptionChoice,
    itfRemoteProvider,
    typRemoteOptionKind,
} from "@/shared/types/remote-config";

const zExample = z
    .object({
        Value: z.unknown(),
        Help: z.string().optional(),
    })
    .loose();

const zOption = z
    .object({
        Name: z.string().min(1),
        Help: z.string().optional(),
        Default: z.unknown().optional(),
        DefaultStr: z.string().optional(),
        Required: z.boolean().optional(),
        Advanced: z.boolean().optional(),
        IsPassword: z.boolean().optional(),
        Sensitive: z.boolean().optional(),
        Hide: z.number().optional(),
        Type: z.string().optional(),
        Exclusive: z.boolean().optional(),
        Examples: z.array(zExample).optional(),
    })
    .loose();

const zProvider = z
    .object({
        Name: z.string().min(1),
        Description: z.string().optional(),
        Prefix: z.string().min(1),
        Options: z.array(zOption).optional(),
    })
    .loose();

function f_DefaultText(o: z.infer<typeof zOption>): string {
    if (o.DefaultStr !== undefined) return o.DefaultStr;
    const d = o.Default;
    if (d === undefined || d === null) return "";
    if (typeof d === "string") return d;
    if (typeof d === "number" || typeof d === "boolean") return String(d);
    return "";
}

function f_Choices(o: z.infer<typeof zOption>): itfRemoteOptionChoice[] {
    return (o.Examples ?? []).map((e) => ({
        value: e.Value === null || e.Value === undefined ? "" : String(e.Value),
        help: e.Help ?? "",
    }));
}

function f_Kind(
    type: string | undefined,
    exclusive: boolean,
    choices: readonly itfRemoteOptionChoice[],
): typRemoteOptionKind {
    if (type === "bool") return "bool";
    if (type === "int" || type === "float64") return "int";
    if (type === "Duration") return "duration";
    if (type === "SizeSuffix") return "size";
    if (exclusive && choices.length > 0) return "enum";
    return "string";
}

/** providers 옵션 하나를 화면 정의로 바꾼다. 숨김 옵션이면 null */
export function parseProviderOption(raw: unknown): itfRemoteOption | null {
    const r = zOption.safeParse(raw);
    if (!r.success) return null;
    const o = r.data;
    if ((o.Hide ?? 0) !== 0) return null;
    const choices = f_Choices(o);
    const exclusive = o.Exclusive === true;
    return {
        name: o.Name,
        help: o.Help ?? "",
        defaultText: f_DefaultText(o),
        required: o.Required === true,
        advanced: o.Advanced === true,
        secret: o.IsPassword === true || o.Sensitive === true,
        kind: f_Kind(o.Type, exclusive, choices),
        choices,
        exclusive,
    };
}

/** `rclone config providers` stdout(JSON 배열) → 종류 정의. 형식이 다르면 RCLONE_PARSE_ERROR */
export function parseProvidersJson(text: string): itfRemoteProvider[] {
    let raw: unknown;
    try {
        raw = JSON.parse(text) as unknown;
    } catch {
        throw new clsAppError("RCLONE_PARSE_ERROR", "rclone 종류 목록을 해석하지 못했습니다.");
    }
    if (!Array.isArray(raw)) {
        throw new clsAppError("RCLONE_PARSE_ERROR", "rclone 종류 목록의 형식이 다릅니다.");
    }
    const out: itfRemoteProvider[] = [];
    for (const item of raw) {
        const r = zProvider.safeParse(item);
        if (!r.success) continue;
        const p = r.data;
        const options = (p.Options ?? [])
            .map(parseProviderOption)
            .filter((o): o is itfRemoteOption => o !== null);
        out.push({
            type: p.Prefix,
            description: p.Description ?? p.Name,
            oauth: options.some((o) => o.name === "token"),
            options,
        });
    }
    return out.toSorted((a, b) => a.type.localeCompare(b.type));
}

/** rc `config/create`·`update` 응답의 Option → 화면 정의(숨김 여부와 무관하게 하나만) */
export function parseQuestionOption(raw: unknown): itfRemoteOption | null {
    if (raw === null || raw === undefined) return null;
    const r = zOption.safeParse(raw);
    if (!r.success) return null;
    const o = r.data;
    const choices = f_Choices(o);
    const exclusive = o.Exclusive === true;
    return {
        name: o.Name,
        help: o.Help ?? "",
        defaultText: f_DefaultText(o),
        required: o.Required === true,
        advanced: false,
        secret: o.IsPassword === true || o.Sensitive === true,
        kind: f_Kind(o.Type, exclusive, choices),
        choices,
        exclusive,
    };
}
