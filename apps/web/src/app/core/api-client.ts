import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Channel } from '@hefesto/shared-types';
import type {
  BindingDto,
  Board,
  ChannelInput,
  ChannelSummary,
  ChannelTemplateDto,
  GenerateIdeasRequest,
  GenerateScriptRequest,
  IdeaDto,
  JobDto,
  LogEntry,
  LogLevel,
  Page,
  ProduceEstimate,
  ProduceRequest,
  ProductionDetail,
  ProductionSummary,
  ProviderConfig,
  ProviderDto,
  QueueState,
  ScriptDto,
  ScriptPatch,
  SecretDto,
  SystemInfo,
  Telemetry,
  VoicePreviewRequest,
  VoicePreviewResponse,
} from '@hefesto/shared-types';
import type { Lane } from '@hefesto/shared-types';
import { Observable } from 'rxjs';

/**
 * Typed client for every REST route in libs/shared/types/src/lib/api.ts.
 * All requests go through the /api proxy (see apps/web/proxy.conf.json).
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  // ── Channels ────────────────────────────────────────────────────────
  listChannels(): Observable<ChannelSummary[]> {
    return this.http.get<ChannelSummary[]>(`${this.base}/channels`);
  }

  listChannelTemplates(): Observable<ChannelTemplateDto[]> {
    return this.http.get<ChannelTemplateDto[]>(`${this.base}/channel-templates`);
  }

  getChannel(slug: string): Observable<Channel> {
    return this.http.get<Channel>(`${this.base}/channels/${slug}`);
  }

  createChannel(input: ChannelInput): Observable<Channel> {
    return this.http.post<Channel>(`${this.base}/channels`, input);
  }

  updateChannel(id: string, patch: Partial<ChannelInput>): Observable<Channel> {
    return this.http.patch<Channel>(`${this.base}/channels/${id}`, patch);
  }

  deleteChannel(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/channels/${id}`);
  }

  previewVoice(channelId: string, request: VoicePreviewRequest): Observable<VoicePreviewResponse> {
    return this.http.post<VoicePreviewResponse>(`${this.base}/channels/${channelId}/voice-preview`, request);
  }

  // ── Ideas & scripts ─────────────────────────────────────────────────
  getBoard(channelId?: string): Observable<Board> {
    return this.http.get<Board>(`${this.base}/board`, { params: this.compact({ channelId }) });
  }

  generateIdeas(request: GenerateIdeasRequest): Observable<IdeaDto[]> {
    return this.http.post<IdeaDto[]>(`${this.base}/ideas/generate`, request);
  }

  updateIdeaStatus(id: string, status: IdeaDto['status']): Observable<IdeaDto> {
    return this.http.patch<IdeaDto>(`${this.base}/ideas/${id}`, { status });
  }

  generateScript(request: GenerateScriptRequest): Observable<ScriptDto> {
    return this.http.post<ScriptDto>(`${this.base}/scripts/generate`, request);
  }

  updateScript(id: string, patch: ScriptPatch): Observable<ScriptDto> {
    return this.http.patch<ScriptDto>(`${this.base}/scripts/${id}`, patch);
  }

  getScript(id: string): Observable<ScriptDto> {
    return this.http.get<ScriptDto>(`${this.base}/scripts/${id}`);
  }

  // ── Productions & library ──────────────────────────────────────────
  estimateProduction(request: ProduceRequest): Observable<ProduceEstimate> {
    return this.http.post<ProduceEstimate>(`${this.base}/productions/estimate`, request);
  }

  produce(request: ProduceRequest): Observable<ProductionSummary[]> {
    return this.http.post<ProductionSummary[]>(`${this.base}/productions`, request);
  }

  listProductions(query: {
    channelId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  } = {}): Observable<Page<ProductionSummary>> {
    return this.http.get<Page<ProductionSummary>>(`${this.base}/productions`, { params: this.compact(query) });
  }

  getProduction(id: string): Observable<ProductionDetail> {
    return this.http.get<ProductionDetail>(`${this.base}/productions/${id}`);
  }

  retryProduction(id: string, fromStage?: string): Observable<ProductionSummary> {
    return this.http.post<ProductionSummary>(`${this.base}/productions/${id}/retry`, { fromStage });
  }

  deleteProduction(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/productions/${id}`);
  }

  fileUrl(productionId: string, file: string): string {
    return `${this.base}/files/${productionId}/${file}`;
  }

  // ── Queue ───────────────────────────────────────────────────────────
  getQueue(): Observable<QueueState> {
    return this.http.get<QueueState>(`${this.base}/queue`);
  }

  pauseQueue(): Observable<QueueState> {
    return this.http.post<QueueState>(`${this.base}/queue/pause`, {});
  }

  resumeQueue(): Observable<QueueState> {
    return this.http.post<QueueState>(`${this.base}/queue/resume`, {});
  }

  skipJob(id: string): Observable<JobDto> {
    return this.http.post<JobDto>(`${this.base}/queue/jobs/${id}/skip`, {});
  }

  cancelJob(id: string): Observable<JobDto> {
    return this.http.post<JobDto>(`${this.base}/queue/jobs/${id}/cancel`, {});
  }

  retryJob(id: string): Observable<JobDto> {
    return this.http.post<JobDto>(`${this.base}/queue/jobs/${id}/retry`, {});
  }

  setJobPriority(id: string, priority: number): Observable<JobDto> {
    return this.http.patch<JobDto>(`${this.base}/queue/jobs/${id}`, { priority });
  }

  setLaneConcurrency(lane: Lane, concurrency: number): Observable<QueueState> {
    return this.http.patch<QueueState>(`${this.base}/queue/lanes/${lane}`, { concurrency });
  }

  // ── Providers & keys ────────────────────────────────────────────────
  listProviders(): Observable<ProviderDto[]> {
    return this.http.get<ProviderDto[]>(`${this.base}/providers`);
  }

  updateProvider(id: string, patch: Partial<ProviderConfig>): Observable<ProviderDto> {
    return this.http.patch<ProviderDto>(`${this.base}/providers/${id}`, patch);
  }

  createProvider(config: Omit<ProviderConfig, 'id'>): Observable<ProviderDto> {
    return this.http.post<ProviderDto>(`${this.base}/providers`, config);
  }

  testProvider(id: string): Observable<import('@hefesto/shared-types').HealthResult> {
    return this.http.post<import('@hefesto/shared-types').HealthResult>(`${this.base}/providers/${id}/test`, {});
  }

  listBindings(channelId?: string | null): Observable<BindingDto[]> {
    return this.http.get<BindingDto[]>(`${this.base}/bindings`, {
      params: this.compact({ channelId: channelId ?? undefined }),
    });
  }

  saveBinding(binding: BindingDto): Observable<BindingDto> {
    return this.http.put<BindingDto>(`${this.base}/bindings`, binding);
  }

  listSecrets(): Observable<SecretDto[]> {
    return this.http.get<SecretDto[]>(`${this.base}/secrets`);
  }

  setSecret(name: string, value: string): Observable<SecretDto> {
    return this.http.put<SecretDto>(`${this.base}/secrets/${name}`, { value });
  }

  deleteSecret(name: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/secrets/${name}`);
  }

  // ── System ──────────────────────────────────────────────────────────
  getTelemetry(): Observable<Telemetry> {
    return this.http.get<Telemetry>(`${this.base}/system/telemetry`);
  }

  getSystemInfo(): Observable<SystemInfo> {
    return this.http.get<SystemInfo>(`${this.base}/system/info`);
  }

  getLogs(query: { limit?: number; level?: LogLevel; source?: string } = {}): Observable<LogEntry[]> {
    return this.http.get<LogEntry[]>(`${this.base}/logs`, { params: this.compact(query) });
  }

  private compact(query: Record<string, unknown>): HttpParams {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return params;
  }
}
