import z from "zod"
import path from "path"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"

const DEFAULT_MCP_URL = "https://mcpserver.getaltimate.com/sse"

const AltimateCredentials = z.object({
  altimateUrl: z.string(),
  altimateInstanceName: z.string(),
  altimateApiKey: z.string(),
  mcpServerUrl: z.string().optional(),
})
type AltimateCredentials = z.infer<typeof AltimateCredentials>

const DatamateSummary = z.object({
  id: z.coerce.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  integrations: z
    .array(
      z.object({
        id: z.coerce.string(),
        tools: z.array(z.object({ key: z.string() })).optional(),
      }),
    )
    .nullable()
    .optional(),
  memory_enabled: z.boolean().optional(),
  privacy: z.string().optional(),
})

const IntegrationSummary = z.object({
  id: z.coerce.string(),
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  tools: z
    .array(
      z.object({
        key: z.string(),
        name: z.string().optional(),
        enable_all: z.array(z.string()).optional(),
      }),
    )
    .optional(),
})

export namespace AltimateApi {
  export function credentialsPath(): string {
    return path.join(Global.Path.home, ".altimate", "altimate.json")
  }

  export async function isConfigured(): Promise<boolean> {
    return Filesystem.exists(credentialsPath())
  }

  export async function getCredentials(): Promise<AltimateCredentials> {
    const p = credentialsPath()
    if (!(await Filesystem.exists(p))) {
      throw new Error(`Altimate credentials not found at ${p}`)
    }
    const raw = JSON.parse(await Filesystem.readText(p))
    return AltimateCredentials.parse(raw)
  }

  async function request(creds: AltimateCredentials, method: string, endpoint: string, body?: unknown) {
    const url = `${creds.altimateUrl}${endpoint}`
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${creds.altimateApiKey}`,
        "x-tenant": creds.altimateInstanceName,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!res.ok) {
      throw new Error(`API ${method} ${endpoint} failed with status ${res.status}`)
    }
    return res.json()
  }

  export async function listDatamates() {
    const creds = await getCredentials()
    const data = await request(creds, "GET", "/datamates/")
    const list = Array.isArray(data) ? data : (data.datamates ?? data.data ?? [])
    return list.map((d: unknown) => DatamateSummary.parse(d)) as z.infer<typeof DatamateSummary>[]
  }

  export async function getDatamate(id: string) {
    const creds = await getCredentials()
    try {
      const data = await request(creds, "GET", `/datamates/${id}/summary`)
      const raw = data.datamate ?? data
      return DatamateSummary.parse(raw)
    } catch (e) {
      // Fallback to list if single-item endpoint is unavailable (404)
      if (e instanceof Error && e.message.includes("status 404")) {
        const all = await listDatamates()
        const found = all.find((d) => d.id === id)
        if (!found) {
          throw new Error(`Datamate with ID ${id} not found`)
        }
        return found
      }
      throw e
    }
  }

  export async function createDatamate(payload: {
    name: string
    description?: string
    integrations?: Array<{ id: string; tools: Array<{ key: string }> }>
    memory_enabled?: boolean
    privacy?: string
  }) {
    const creds = await getCredentials()
    const data = await request(creds, "POST", "/datamates/", payload)
    // Backend returns { id: number } for create
    const id = String(data.id ?? data.datamate?.id)
    return { id, name: payload.name }
  }

  export async function updateDatamate(
    id: string,
    payload: {
      name?: string
      description?: string
      integrations?: Array<{ id: string; tools: Array<{ key: string }> }>
      memory_enabled?: boolean
      privacy?: string
    },
  ) {
    const creds = await getCredentials()
    const data = await request(creds, "PATCH", `/datamates/${id}`, payload)
    const raw = data.datamate ?? data
    return DatamateSummary.parse(raw)
  }

  export async function deleteDatamate(id: string) {
    const creds = await getCredentials()
    await request(creds, "DELETE", `/datamates/${id}`)
  }

  export async function listIntegrations() {
    const creds = await getCredentials()
    const data = await request(creds, "GET", "/datamate_integrations/")
    const list = Array.isArray(data) ? data : (data.integrations ?? data.data ?? [])
    return list.map((d: unknown) => IntegrationSummary.parse(d)) as z.infer<typeof IntegrationSummary>[]
  }

  /** Resolve integration IDs to full integration objects with all tools enabled (matching frontend behavior). */
  export async function resolveIntegrations(
    integrationIds: string[],
  ): Promise<Array<{ id: string; tools: Array<{ key: string }> }>> {
    const allIntegrations = await listIntegrations()
    return integrationIds.map((id) => {
      const def = allIntegrations.find((i) => i.id === id)
      const tools =
        def?.tools?.flatMap((t) => (t.enable_all ?? [t.key]).map((k) => ({ key: k }))) ?? []
      return { id, tools }
    })
  }

  export function buildMcpConfig(creds: AltimateCredentials, datamateId: string) {
    return {
      type: "remote" as const,
      url: creds.mcpServerUrl ?? DEFAULT_MCP_URL,
      oauth: false as const,
      headers: {
        Authorization: `Bearer ${creds.altimateApiKey}`,
        "x-datamate-id": String(datamateId),
        "x-tenant": creds.altimateInstanceName,
        "x-altimate-url": creds.altimateUrl,
      },
    }
  }
}
