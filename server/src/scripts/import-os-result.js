'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { runWorkflowCommand } = require('../services/workflow-command');

const EXPECTED_PLATFORMS = [
  'doubao',
  'deepseek',
  'tencent_yuanbao',
  'tongyi_qianwen',
  'kimi'
];

const EXPECTED_QUESTIONS = [
  'Q001',
  'Q002',
  'Q003',
  'Q004',
  'Q005',
  'Q006'
];

const ALLOWED_ELIGIBILITY = new Set([
  'eligible',
  'eligible_with_limitations'
]);

function validateCustomerDeliveryResult(payload) {
  if (
    !payload ||
    payload.adapterType !==
      'geogi_customer_delivery_v1_result_adapter'
  ) {
    throw new Error(
      '不是受支持的 GeoGi Customer Delivery V1 Result Adapter 文件'
    );
  }

  const projectId = String(
    payload.projectId || ''
  ).trim();

  if (!/^GG-P-\d{6}-\d{6}$/.test(projectId)) {
    throw new Error(
      `结果文件缺少有效项目编号：${projectId || '(empty)'}`
    );
  }

  const rows = Array.isArray(payload.aiConversations)
    ? payload.aiConversations
    : [];

  const summary =
    payload.summary &&
    typeof payload.summary === 'object'
      ? payload.summary
      : {};

  if (rows.length !== 30) {
    throw new Error(
      `Customer Delivery 必须恰好包含30条正式问答，当前 ${rows.length} 条`
    );
  }

  if (
    Number(summary.plannedRunCount) !== 30 ||
    Number(summary.exportedConversationCount) !== 30 ||
    Number(summary.excludedRunCount) !== 0 ||
    summary.allPlannedRunsExported !== true ||
    summary.usesCapturedRawAnswerOnly !== true ||
    summary.shareLinkRereadRequired !== false
  ) {
    throw new Error(
      'Result Adapter summary 未满足30/30正式交付合同'
    );
  }

  if (
    Array.isArray(payload.excludedRuns) &&
    payload.excludedRuns.length
  ) {
    throw new Error(
      'Result Adapter 仍包含 excludedRuns'
    );
  }

  const pairs = new Set();
  const runIds = new Set();
  const rawIds = new Set();

  const platformCounts = new Map(
    EXPECTED_PLATFORMS.map(
      (name) => [name, 0]
    )
  );

  const questionCounts = new Map(
    EXPECTED_QUESTIONS.map(
      (name) => [name, 0]
    )
  );

  const sanitized = rows.map(
    (item, index) => {
      const platformId = String(
        item.platformId || ''
      ).trim();

      const questionId = String(
        item.sourceQuestionId || ''
      ).trim();

      const answer = String(
        item.answer || ''
      ).trim();

      const question = String(
        item.question || ''
      ).trim();

      const runId = String(
        item.platformTestRunId || ''
      ).trim();

      const rawId = String(
        item.rawAnswerId || ''
      ).trim();

      if (
        !EXPECTED_PLATFORMS.includes(
          platformId
        )
      ) {
        throw new Error(
          `第${index + 1}条平台无效：${platformId}`
        );
      }

      if (
        !EXPECTED_QUESTIONS.includes(
          questionId
        )
      ) {
        throw new Error(
          `第${index + 1}条问题编号无效：${questionId}`
        );
      }

      if (!question) {
        throw new Error(
          `第${index + 1}条问题为空`
        );
      }

      if (!answer) {
        throw new Error(
          `第${index + 1}条回答为空`
        );
      }

      if (
        !ALLOWED_ELIGIBILITY.has(
          item.eligibilityStatus
        )
      ) {
        throw new Error(
          `第${index + 1}条Eligibility无效：${item.eligibilityStatus}`
        );
      }

      if (!runId || !rawId) {
        throw new Error(
          `第${index + 1}条缺少OS追溯ID`
        );
      }

      const pair =
        `${questionId}::${platformId}`;

      if (pairs.has(pair)) {
        throw new Error(
          `重复的平台问答组合：${pair}`
        );
      }

      if (runIds.has(runId)) {
        throw new Error(
          `重复PlatformTestRun ID：${runId}`
        );
      }

      if (rawIds.has(rawId)) {
        throw new Error(
          `重复RawAnswer ID：${rawId}`
        );
      }

      pairs.add(pair);
      runIds.add(runId);
      rawIds.add(rawId);

      platformCounts.set(
        platformId,
        platformCounts.get(platformId) + 1
      );

      questionCounts.set(
        questionId,
        questionCounts.get(questionId) + 1
      );

      return {
        ...item,
        link: '',
        url: ''
      };
    }
  );

  for (const platform of EXPECTED_PLATFORMS) {
    if (platformCounts.get(platform) !== 6) {
      throw new Error(
        `${platform}正式问答不是6条`
      );
    }
  }

  for (const question of EXPECTED_QUESTIONS) {
    if (questionCounts.get(question) !== 5) {
      throw new Error(
        `${question}平台覆盖不是5个`
      );
    }
  }

  if (
    pairs.size !== 30 ||
    runIds.size !== 30 ||
    rawIds.size !== 30
  ) {
    throw new Error(
      '30/30唯一性合同未通过'
    );
  }

  return {
    projectId,
    aiConversations: sanitized,
    platformCounts:
      Object.fromEntries(platformCounts),
    questionCounts:
      Object.fromEntries(questionCounts)
  };
}

async function main() {
  const inputArg = process.argv[2];

  if (!inputArg) {
    throw new Error(
      '请提供 GeoGi OS Result Adapter JSON 文件路径'
    );
  }

  const inputPath = path.resolve(inputArg);

  const payload = JSON.parse(
    fs.readFileSync(
      inputPath,
      'utf8'
    )
  );

  const validated =
    validateCustomerDeliveryResult(payload);

  const result = await runWorkflowCommand({
    action: 'generate_report',
    projectId: validated.projectId,
    aiConversations:
      validated.aiConversations,
    skipShareLinkReread: true,
    requireQualityOk: true
  });

  console.log(
    JSON.stringify(
      {
        ...result,
        sourceAdapterType:
          payload.adapterType,
        sourceTaskId:
          payload.sourceTaskId,
        importedConversationCount:
          validated.aiConversations.length,
        excludedRunCount:
          payload.summary &&
          payload.summary.excludedRunCount,
        usesCapturedRawAnswerOnly:
          true,
        shareLinkRereadRequired:
          false
      },
      null,
      2
    )
  );

  if (!result || !result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error:
            error && error.message
              ? error.message
              : String(error)
        },
        null,
        2
      )
    );

    process.exitCode = 1;
  });
}

module.exports = {
  validateCustomerDeliveryResult
};
