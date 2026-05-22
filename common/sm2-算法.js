/**
 * SM-2 间隔重复算法（纯逻辑，零依赖，Server/Doves 共享）
 *
 * 反馈等级映射：
 *   unknown/again → quality=1  (完全不认识)
 *   vague         → quality=2  (模糊，不太确定)
 *   hard          → quality=3  (费力，模糊但能想起)
 *   good          → quality=4  (认识，稍有犹豫)
 *   known/easy    → quality=5  (非常熟悉/秒答)
 */

export function calculateSM2(currentRecord, quality) {
  let { ease_factor, interval_days, repetition_count } = currentRecord;

  if (ease_factor < 1.3) ease_factor = 1.3;

  if (quality < 3) {
    // 回答错误/不认识 → 重置间隔
    repetition_count = 0;
    interval_days = 1;
  } else {
    // 回答正确
    if (repetition_count === 0) {
      interval_days = 1;
    } else if (repetition_count === 1) {
      interval_days = 6;
    } else {
      interval_days = Math.round(interval_days * ease_factor);
    }
    repetition_count += 1;
  }

  // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  ease_factor = ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (ease_factor < 1.3) ease_factor = 1.3;

  // 下次复习日期
  const next_review_date = new Date();
  next_review_date.setDate(next_review_date.getDate() + interval_days);

  // 熟知度（0-1）
  const familiarity = Math.min(1, (repetition_count * 0.15 + (quality >= 3 ? 0.1 : 0)));

  // 记忆稳定性
  const memory_stability = Math.min(1, interval_days / 365);

  // 判断阶段
  let stage = 'learning';
  if (repetition_count >= 5 && ease_factor >= 2.0 && interval_days >= 30) {
    stage = 'mastered';
  } else if (repetition_count >= 2) {
    stage = 'reviewing';
  }

  return {
    ease_factor: Math.round(ease_factor * 100) / 100,
    interval_days,
    repetition_count,
    next_review_date,
    familiarity: Math.round(familiarity * 100) / 100,
    memory_stability: Math.round(memory_stability * 100) / 100,
    stage,
  };
}

/**
 * 将用户反馈转为 SM-2 quality 值
 * @param {string} feedback - 'unknown' | 'vague' | 'known' | 'again' | 'hard' | 'good' | 'easy'
 * @param {number} pronunciationScore - 可选，语音评测分数
 */
export function feedbackToQuality(feedback, pronunciationScore) {
  let quality;
  switch (feedback) {
    case 'unknown':
    case 'again':
      quality = 1;
      break;
    case 'vague':
      quality = 2;
      break;
    case 'hard':
      quality = 3;
      break;
    case 'good':
      quality = 4;
      break;
    case 'known':
    case 'easy':
      quality = 5;
      break;
    default:
      quality = 3;
  }

  // 语音评测分数微调
  if (pronunciationScore !== undefined && pronunciationScore !== null) {
    if (pronunciationScore >= 80) quality = Math.min(5, quality + 1);
    else if (pronunciationScore < 40) quality = Math.max(0, quality - 1);
  }

  return quality;
}
