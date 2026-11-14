/**
 * @file RegistrationField - 审核端飞机注册号字段（V4.10.0）
 * @description
 *  受控输入框 + 「无注册号（N/A）」开关，替换原只读展示。
 *  - 未选「无注册号」：输入自动转大写并过滤为字母/数字/连字符，实时校验 2-20 位格式；
 *  - 选中「无注册号」：值固定为 N/A 且输入框只读，再次点击取消并清空；
 *  - 留空表示「未填写」，与 N/A（审核确认无注册号）语义区分。
 */
import { REGISTRATION_NA, REGISTRATION_PATTERN } from '../../shared/registration';

interface RegistrationFieldProps {
  /** 当前值（空串表示未填写） */
  value: string;
  /** 提交中禁用交互 */
  disabled?: boolean;
  /** 值变更回调（已归一为大写或 N/A） */
  onChange: (value: string) => void;
}

export function RegistrationField({ value, disabled = false, onChange }: RegistrationFieldProps) {
  const isNa = value === REGISTRATION_NA;
  const trimmed = value.trim();
  const showFormatError = !isNa && trimmed !== '' && !REGISTRATION_PATTERN.test(trimmed);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-gray-500 text-xs">飞机注册号</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(isNa ? '' : REGISTRATION_NA)}
          className={`px-2 py-0.5 rounded border text-xs font-medium transition-colors disabled:opacity-50 ${
            isNa
              ? 'border-blue-700 bg-blue-700 text-white'
              : 'border-gray-300 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-700'
          }`}
          aria-pressed={isNa}
        >
          无注册号
        </button>
      </div>
      <input
        type="text"
        value={isNa ? REGISTRATION_NA : value}
        readOnly={isNa}
        disabled={disabled}
        maxLength={20}
        placeholder="如 B-1234（留空表示未填写）"
        onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
        className={`w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 ${
          showFormatError ? 'border-red-400 text-red-700' : 'border-gray-300 text-gray-800'
        } ${isNa ? 'bg-blue-50 text-blue-800' : ''}`}
      />
      {showFormatError ? (
        <p className="text-xs text-red-600 mt-1">格式不合法：需 2-20 位字母、数字或连字符，且不以连字符开头</p>
      ) : (
        <p className="text-xs text-gray-400 mt-1">
          {isNa ? '已标记为「确认无注册号」，保存后不再展示具体编号' : '选填；无注册号的图片请点击右上角开关'}
        </p>
      )}
    </div>
  );
}
