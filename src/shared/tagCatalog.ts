/**
 * @file 上传标签目录（V4.11）
 * @description
 *  依据 docs/prd-v4.11-upload-tag-optimization.md 第五节定稿三大板块标签清单，
 *  作为上传页标签多选的唯一事实来源；数组顺序即展示顺序。
 *  同时集中维护分区驱动的动态表单字段、必填校验与 structured_tags 组装规则，
 *  供桌面端 UploadPage 与移动端 /m/upload 共用，避免两端规则漂移。
 */

/** 照片分区（与后端 category 取值一致） */
export type PhotoCategory = 'aviation' | 'railway' | 'automobile';

/** 分区展示定义 */
export interface UploadCategoryDef {
  id: PhotoCategory;
  name: string;
}

/** 上传页分区顺序：航空 → 铁路 → 汽车 */
export const UPLOAD_CATEGORIES: readonly UploadCategoryDef[] = [
  { id: 'aviation', name: '航空' },
  { id: 'railway', name: '铁路' },
  { id: 'automobile', name: '汽车' },
];

/**
 * 三大板块标签清单（V4.11 定稿）
 * - 航空 19 项
 * - 铁路 20 项
 * - 汽车 11 项
 */
export const TAG_CATALOG: Record<PhotoCategory, readonly string[]> = {
  aviation: [
    '窄体机',
    '宽体机',
    '彩绘',
    '货机',
    '夜拍',
    '风格图',
    '直升机',
    '支线客机',
    '公务机',
    '报废飞机',
    '轻型飞机',
    '航展',
    '机场',
    '水上飞机',
    '航博展机',
    '特殊飞机',
    '事故',
    '其它',
    '座舱 / 驾驶舱',
  ],
  railway: [
    '普速机车',
    '高速动车组',
    '动集',
    '动卧',
    '客运车厢',
    '货运车厢',
    '内燃机车',
    '蒸汽机车',
    '火车站台',
    '铁路桥 / 隧道',
    '站台',
    '乘降所',
    '旅游列车',
    '动车检',
    '检测车',
    '工程车',
    '铁路博物馆展车',
    '地铁',
    '风格图',
    '试验列车',
  ],
  automobile: [
    '常规车型',
    '无轨电车',
    'BRT',
    '小快途接驳车',
    '支线',
    '专车',
    '双层',
    '旅游专线',
    '中巴',
    '特殊车型',
    '车展展车',
  ],
};

/** structured_tags 中的业务字段键（与详情页展示、后端识别合并保持同名） */
export const META_SHOOT_TIME = '拍摄时间';
export const META_AIRCRAFT_MODEL = '机型';
export const META_TRAIN_NUMBER = '车号';
export const META_TRAIN_MODEL = '车型';
export const META_TRAIN_LINE = '拍摄线路';
export const META_TRAIN_BUREAU = '所属局段';
export const META_VEHICLE_NUMBER = '车辆编号';
export const META_VEHICLE_MODEL = '车型';

/** 分区动态表单字段集合（跨分区共用一个草稿对象） */
export interface CategoryFormFields {
  /** 拍摄时间（datetime-local，YYYY-MM-DDTHH:mm） */
  shootTime: string;
  /** 航空：机型（文本或 N/A） */
  aircraftModel: string;
  /** 铁路：车号 */
  trainNumber: string;
  /** 铁路：车型 */
  trainModel: string;
  /** 铁路：拍摄线路 */
  trainLine: string;
  /** 铁路：所属局段 */
  trainBureau: string;
  /** 汽车：车辆编号 */
  vehicleNumber: string;
  /** 汽车：车型 */
  vehicleModel: string;
  /** 航空 / 汽车：拍摄地点（文本或 N/A） */
  location: string;
}

/** 空分区字段 */
export const EMPTY_CATEGORY_FIELDS: CategoryFormFields = {
  shootTime: '',
  aircraftModel: '',
  trainNumber: '',
  trainModel: '',
  trainLine: '',
  trainBureau: '',
  vehicleNumber: '',
  vehicleModel: '',
  location: '',
};

/** 将 Date 格式化为 datetime-local 输入所需字符串（本地时区） */
export function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

/** 分区动态字段是否满足必填要求（拍摄时间三区通用） */
export function isCategoryFormValid(category: PhotoCategory, fields: CategoryFormFields): boolean {
  if (!fields.shootTime.trim()) return false;
  switch (category) {
    case 'aviation':
      return Boolean(fields.aircraftModel.trim() && fields.location.trim());
    case 'railway':
      return Boolean(
        fields.trainNumber.trim() &&
          fields.trainModel.trim() &&
          fields.trainLine.trim() &&
          fields.trainBureau.trim(),
      );
    case 'automobile':
      return Boolean(fields.vehicleNumber.trim() && fields.vehicleModel.trim() && fields.location.trim());
  }
}

/**
 * 组装分区专属 structured_tags
 * 拍摄地点仍由 location 字段单独提交（详情页通用行），此处不重复写入。
 */
export function buildCategoryStructuredTags(
  category: PhotoCategory,
  fields: CategoryFormFields,
): Record<string, string> {
  const result: Record<string, string> = {
    [META_SHOOT_TIME]: fields.shootTime.trim(),
  };
  if (category === 'aviation') {
    result[META_AIRCRAFT_MODEL] = fields.aircraftModel.trim();
  } else if (category === 'railway') {
    result[META_TRAIN_NUMBER] = fields.trainNumber.trim();
    result[META_TRAIN_MODEL] = fields.trainModel.trim();
    result[META_TRAIN_LINE] = fields.trainLine.trim();
    result[META_TRAIN_BUREAU] = fields.trainBureau.trim();
  } else {
    result[META_VEHICLE_NUMBER] = fields.vehicleNumber.trim();
    result[META_VEHICLE_MODEL] = fields.vehicleModel.trim();
  }
  return result;
}
