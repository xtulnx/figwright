<script setup lang="ts">
import { computed } from 'vue';

import { useSharedNow } from '../composables/useSharedNow.js';
import { formatClockTime, formatRelativeTime } from '../lib/format.js';
import { t } from '../lib/i18n.js';
import type { RelayClientState } from '../relay/state.js';
import UiCopyButton from './UiCopyButton.vue';
import UiMetaRow from './UiMetaRow.vue';
import UiSection from './UiSection.vue';

const props = defineProps<{
  state: RelayClientState;
  sessionId: string;
  /** Shown next to the server's, so a version skew between the two is visible in one place. */
  pluginVersion: string;
  /** Built lazily — the bundle embeds every recorded call, so only serialize on click. */
  buildDiagnostics: () => string;
}>();

const now = useSharedNow();
const shortId = computed(() => `${props.sessionId.slice(0, 8)}…`);
const errorEntries = computed(() => props.state.activity.filter(e => e.status === 'error'));

/**
 * Mean duration of the calls still in the recent list. Unlike the totals, this can only be measured
 * over what's retained (ACTIVITY_LIMIT), which is why it's labelled as recent — it's a health
 * signal, not an accounting figure. Pending calls have no duration yet and are left out.
 */
const averageMs = computed(() => {
  const settled = props.state.activity.filter(e => e.durationMs !== undefined);
  if (settled.length === 0) return null;
  const total = settled.reduce((sum, e) => sum + (e.durationMs ?? 0), 0);
  return Math.round(total / settled.length);
});
</script>

<template>
  <div class="divide-y divide-line px-1.5">
    <UiSection :title="t('Connection')">
      <dl class="space-y-1">
        <UiMetaRow :label="t('Session')" mono>
          {{ shortId }}{{ state.sessionResumed ? t(' (resumed)') : '' }}
        </UiMetaRow>
        <UiMetaRow :label="t('Reconnects')" mono>{{ state.reconnectCount }}</UiMetaRow>
        <UiMetaRow :label="t('Plugin')" mono>v{{ pluginVersion }}</UiMetaRow>
        <UiMetaRow v-if="state.serverVersion !== null" :label="t('Server')" mono>
          v{{ state.serverVersion }}
        </UiMetaRow>
      </dl>
      <p
        v-if="state.lastError !== null"
        class="mt-1.5 rounded-md bg-raised p-1.5 font-mono text-meta wrap-break-word text-danger"
      >
        {{ state.lastError }}
      </p>
    </UiSection>

    <UiSection :title="t('Calls')">
      <dl class="space-y-1">
        <UiMetaRow :label="t('Total')" mono>{{ state.totalCalls }}</UiMetaRow>
        <UiMetaRow
          :label="t('Failed')"
          mono
          :value-class="state.failedCalls > 0 ? 'text-danger' : ''"
        >
          {{ state.failedCalls }}
        </UiMetaRow>
        <UiMetaRow v-if="averageMs !== null" :label="t('Avg (recent)')" mono
          >{{ averageMs }}ms</UiMetaRow
        >
      </dl>
    </UiSection>

    <UiSection :title="t('Recent errors')">
      <ul v-if="errorEntries.length > 0" class="space-y-1.5">
        <li v-for="entry in errorEntries" :key="entry.id" class="rounded-md bg-raised p-1.5">
          <div class="flex items-baseline justify-between gap-2">
            <span class="min-w-0 truncate font-medium text-danger">{{ entry.method }}</span>
            <span
              class="shrink-0 text-meta text-faint tabular-nums"
              :title="formatClockTime(entry.startedAt)"
            >
              {{ formatRelativeTime(entry.startedAt, now.getTime()) }}
            </span>
          </div>
          <div class="mt-0.5 font-mono text-meta leading-snug wrap-break-word text-dim">
            {{ entry.error }}
          </div>
        </li>
      </ul>
      <p v-else class="text-dim">{{ t('No errors.') }}</p>
    </UiSection>

    <UiSection :title="t('Diagnostics')">
      <UiCopyButton
        :label="t('Copy diagnostic bundle')"
        :value="buildDiagnostics"
        :disabled="state.activity.length === 0"
      />
      <p class="mt-1.5 text-meta leading-relaxed text-dim">
        {{ t('For bug reports · includes your design content.') }}
      </p>
    </UiSection>
  </div>
</template>
