import { jsonrepair } from 'jsonrepair';
import { parseBigInt, stringifyBigInt } from '../utils/jsonBigInt.js';

/**
 * 将严格 JSON 按指定缩进格式化，同时保留大整数精度。
 *
 * @param {string} content
 * @param {number} indent
 */
export function formatStrictJson(content, indent = 2) {
  return stringifyBigInt(parseBigInt(content), null, indent);
}

/**
 * 检查裸值中的注释标记，避免 jsonrepair 静默截断数据。
 *
 * @param {string} value
 */
export function hasAmbiguousCommentInBareValue(value) {
  let quote = null;
  let escaped = false;
  let bareValueStart = null;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      bareValueStart = null;
      continue;
    }
    if (char === ':') {
      bareValueStart = index + 1;
      continue;
    }
    if ('{[,\n'.includes(char) || '}]'.includes(char)) {
      bareValueStart = null;
      continue;
    }
    if (char !== '/' || !['/', '*'].includes(value[index + 1])) continue;

    const prefix = bareValueStart === null
      ? ''
      : value.slice(bareValueStart, index).trim();
    if (prefix && !isJsonLikeBareScalar(prefix)) return true;

    if (value[index + 1] === '*') {
      const close = value.indexOf('*/', index + 2);
      if (close === -1) return false;
      bareValueStart = null;
      index = close + 1;
      continue;
    }

    const lineEnd = value.indexOf('\n', index + 2);
    if (lineEnd === -1) break;
    bareValueStart = null;
    index = lineEnd;
  }

  return false;
}

/**
 * 尝试在本地修复 JSON，无法安全修复时返回 null。
 *
 * @param {string} content
 * @param {number} indent
 * @returns {string | null}
 */
export function tryRepairJsonLocally(content, indent = 2) {
  if (hasAmbiguousCommentInBareValue(content)) return null;

  try {
    return formatStrictJson(jsonrepair(content), indent);
  } catch {
    return null;
  }
}

/** @param {string} value */
function isJsonLikeBareScalar(value) {
  return (
    value === 'true' ||
    value === 'false' ||
    value === 'null' ||
    /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)
  );
}
