<script setup lang="ts">
import type { PluginContextEvent } from '../../protocol/bridge.js';
import type { BackupController } from '../composables/useBackup.js';
import { t, issueText } from '../lib/i18n.js';
import UiCopyButton from './UiCopyButton.vue';
import UiSection from './UiSection.vue';

const props = defineProps<{ controller: BackupController; context: PluginContextEvent | null }>();
const chooseFile = (event: Event): void => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void props.controller.load(file);
  input.value = '';
};
</script>

<template>
  <div class="divide-y divide-line px-1.5">
    <UiSection>
      <p class="font-medium">{{ t('Local page backup') }}</p>
      <p class="mt-1 text-meta text-dim">
        {{
          t('Save and restore editable designs directly in this plugin. No AI or server required.')
        }}
      </p>
      <p v-if="!controller.canUse.value" class="mt-2 text-meta text-warning">
        {{ t('Open a Figma Design file to back up or restore pages.') }}
      </p>
    </UiSection>

    <UiSection :title="t('Save a page')">
      <p class="mb-2 truncate text-meta text-dim" :title="context?.pageName">
        {{ context?.pageName ?? t('Waiting for file context…') }}
      </p>
      <button
        class="w-full rounded-md bg-brand px-3 py-2 font-medium text-white disabled:opacity-40"
        :disabled="
          controller.state.busy || !controller.canUse.value || controller.state.uncertainJob
        "
        @click="controller.exportPage()"
      >
        {{ t('Back up current page') }}
      </button>
      <button
        v-if="controller.state.downloadReady"
        class="mt-2 w-full rounded-md border border-line px-3 py-2 hover:bg-hover disabled:opacity-40"
        :disabled="controller.state.busy"
        @click="controller.download()"
      >
        {{ t('Download .figwright-backup') }}
      </button>
      <p
        v-if="controller.state.downloadReady"
        class="mt-1 truncate text-meta text-dim"
        :title="controller.state.downloadFileName"
      >
        {{ controller.state.downloadFileName }}
      </p>
      <p
        v-if="controller.state.downloadReady && controller.state.exportedIssues"
        class="mt-2 text-meta text-warning"
      >
        {{
          t('Experimental snapshot · {count} coverage issue(s). Keep another backup.', {
            count: controller.state.exportedIssues,
          })
        }}
      </p>
      <details
        v-if="controller.state.downloadReady && controller.state.exportedIssueList.length"
        class="mt-2 text-meta text-warning"
      >
        <summary class="cursor-pointer">
          {{
            t('Review {count} coverage issue(s)', {
              count: controller.state.exportedIssueList.length,
            })
          }}
        </summary>
        <ul class="mt-2 list-disc space-y-1 pl-4 wrap-break-word">
          <li
            v-for="(issue, index) in controller.state.exportedIssueList.slice(0, 50)"
            :key="index"
          >
            {{ issueText(issue) }}
          </li>
        </ul>
        <p v-if="controller.state.exportedIssueList.length > 50">
          {{ t('Showing the first 50. Copy the report for more.') }}
        </p>
        <UiCopyButton class="mt-2" :label="t('Copy report')" :value="controller.report" />
      </details>
    </UiSection>

    <UiSection :title="t('Restore a backup')">
      <label
        class="block rounded-md border border-line px-3 py-2 text-center"
        :class="
          controller.state.busy || controller.state.uncertainJob
            ? 'opacity-40'
            : 'cursor-pointer hover:bg-hover'
        "
        >{{ t('Choose a .figwright-backup file')
        }}<input
          class="sr-only"
          type="file"
          accept=".figwright-backup"
          :disabled="controller.state.busy || controller.state.uncertainJob"
          @change="chooseFile"
        />
      </label>
      <template v-if="controller.state.fileName">
        <p class="mt-2 truncate text-meta text-dim" :title="controller.state.fileName">
          {{ controller.state.fileName }}
        </p>
        <label class="mt-3 block text-meta text-dim"
          >{{ t('Page from backup')
          }}<select
            v-model="controller.state.selectedPage"
            class="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-fg"
            :disabled="controller.state.busy || controller.state.uncertainJob"
          >
            <option value="">{{ t('All captured pages') }}</option>
            <option v-for="page in controller.state.pages" :key="page.id" :value="page.id">
              {{ page.name }}
            </option>
          </select>
        </label>
        <label class="mt-2 block text-meta text-dim"
          >{{ t('New page name (optional)')
          }}<input
            v-model="controller.state.pageName"
            class="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-fg"
            :placeholder="t('Original name (restored)')"
            :disabled="controller.state.busy || controller.state.uncertainJob"
          />
        </label>
        <div v-if="controller.plan.value" class="mt-3 rounded-md bg-raised p-2 text-meta">
          <p>
            {{
              t('{nodes} nodes · {pages} new page(s)', {
                nodes: controller.plan.value.nodes.length,
                pages: controller.plan.value.roots.length,
              })
            }}
          </p>
          <p class="mt-1 text-dim">
            {{
              t(
                'Existing pages are preserved. Fonts and writable properties are checked during restore.',
              )
            }}
          </p>
          <p v-if="controller.plan.value.unsupportedNodes" class="mt-2 text-warning">
            {{
              t(
                '{count} unsupported node(s). Partial restore may replace complex components with frames and lose their links.',
                { count: controller.plan.value.unsupportedNodes },
              )
            }}
          </p>
          <details v-if="controller.plan.value.issues.length" class="mt-2 text-warning">
            <summary class="cursor-pointer">
              {{
                t('Review {count} coverage issue(s)', {
                  count: controller.plan.value.issues.length,
                })
              }}
            </summary>
            <ul class="mt-2 list-disc space-y-1 pl-4 wrap-break-word">
              <li v-for="(issue, index) in controller.plan.value.issues.slice(0, 50)" :key="index">
                {{ issueText(issue) }}
              </li>
            </ul>
            <p v-if="controller.plan.value.issues.length > 50" class="mt-1">
              {{ t('Showing the first 50. Copy the report for more.') }}
            </p>
          </details>
        </div>
        <label
          v-if="controller.plan.value?.issues.length"
          class="mt-3 flex items-start gap-2 text-meta text-warning"
        >
          <input
            v-model="controller.state.allowPartial"
            class="mt-0.5 shrink-0"
            type="checkbox"
            :disabled="controller.state.busy || controller.state.uncertainJob"
          />
          <span>{{
            t(
              'I reviewed the issues and allow a partial restore. Unsupported content may lose properties or component links.',
            )
          }}</span>
        </label>
        <button
          class="mt-3 w-full rounded-md bg-brand px-3 py-2 font-medium text-white disabled:opacity-40"
          :disabled="
            controller.state.busy ||
            controller.state.uncertainJob ||
            !controller.canUse.value ||
            (!!controller.plan.value?.issues.length && !controller.state.allowPartial)
          "
          @click="controller.restore()"
        >
          {{ t('Restore to new page(s)') }}
        </button>
      </template>
    </UiSection>

    <UiSection
      v-if="
        controller.state.busy ||
        controller.state.message ||
        controller.state.error ||
        controller.state.uncertainJob
      "
      :title="t('Progress and report')"
    >
      <div role="status" aria-live="polite">
        <p v-if="controller.state.busy" class="text-meta">{{ t(controller.state.phase) }}</p>
        <progress
          v-if="controller.state.busy"
          class="mt-2 h-1.5 w-full accent-brand"
          :value="controller.state.percent ?? undefined"
          max="100"
          :aria-label="t('Backup task progress')"
        />
        <p v-if="controller.state.busy" class="mt-2 text-meta text-dim">
          {{ t('Keep this plugin open until the task finishes.') }}
        </p>
        <p v-if="controller.state.message" class="mt-2 text-meta text-dim">
          {{ controller.messageText.value }}
        </p>
        <p
          v-if="controller.state.error"
          role="alert"
          class="mt-2 text-meta wrap-break-word text-danger"
        >
          {{ t(controller.state.error) }}
        </p>
      </div>
      <button
        v-if="controller.state.busy"
        class="mt-2 rounded-md border border-line px-3 py-1.5 hover:bg-hover"
        @click="controller.cancel()"
      >
        {{ t('Cancel task') }}
      </button>
      <p v-if="controller.state.uncertainJob" class="mt-2 text-meta text-warning">
        {{
          t(
            'Restore status is uncertain. Check the existing task before retrying to avoid duplicate pages.',
          )
        }}
      </p>
      <div v-if="controller.state.uncertainJob" class="mt-2 flex flex-wrap gap-2">
        <button
          class="rounded-md border border-line px-2 py-1.5 hover:bg-hover"
          :disabled="controller.state.busy"
          @click="controller.checkJob()"
        >
          {{ t('Check restore task') }}
        </button>
        <button
          class="rounded-md border border-line px-2 py-1.5 hover:bg-hover"
          :disabled="controller.state.busy"
          @click="controller.checkJob(true)"
        >
          {{ t('Cancel restore task') }}
        </button>
      </div>
      <details v-if="controller.state.result?.issueCount" class="mt-2 text-meta text-warning">
        <summary class="cursor-pointer">
          {{ t('{count} restore issue(s)', { count: controller.state.result.issueCount }) }}
        </summary>
        <ul class="mt-2 list-disc space-y-1 pl-4 wrap-break-word">
          <li v-for="(issue, index) in controller.state.result.issues" :key="index">
            {{ issueText(issue) }}
          </li>
        </ul>
      </details>
      <UiCopyButton
        class="mt-3"
        :label="t('Copy report')"
        :value="controller.report"
        :disabled="controller.state.busy"
      />
    </UiSection>
  </div>
</template>
