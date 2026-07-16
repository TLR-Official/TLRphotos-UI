import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';

const dbPath = path.join(__dirname, '../../data/tags.db');

export let tagsDb: Database;

interface TagCategory {
  id: string;
  name: string;
  name_en: string;
  description: string;
  icon: string;
}

interface TagObject {
  id: string;
  category_id: string;
  name: string;
  name_en: string;
  description: string;
}

interface TagAttribute {
  id: string;
  object_id: string;
  key: string;
  key_en: string;
  label: string;
  type: 'text' | 'select' | 'number';
  options?: string;
}

const initSchema = async () => {
  await tagsDb.exec(`
    CREATE TABLE IF NOT EXISTS tag_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_en TEXT NOT NULL,
      description TEXT,
      icon TEXT
    );

    CREATE TABLE IF NOT EXISTS tag_objects (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      name TEXT NOT NULL,
      name_en TEXT NOT NULL,
      description TEXT,
      FOREIGN KEY (category_id) REFERENCES tag_categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tag_attributes (
      id TEXT PRIMARY KEY,
      object_id TEXT NOT NULL,
      key TEXT NOT NULL,
      key_en TEXT NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      options TEXT,
      FOREIGN KEY (object_id) REFERENCES tag_objects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tag_objects_category ON tag_objects(category_id);
    CREATE INDEX IF NOT EXISTS idx_tag_attributes_object ON tag_attributes(object_id);
  `);
};

const seedTags = async () => {
  const categoryCount = await tagsDb.get('SELECT COUNT(*) as count FROM tag_categories');
  if (categoryCount.count > 0) return;

  const categories: TagCategory[] = [
    {
      id: 'aviation',
      name: '航空',
      name_en: 'Aviation',
      description: '民用航空相关影像，包括飞行器、机场、地勤等',
      icon: '✈️',
    },
    {
      id: 'railway',
      name: '铁路',
      name_en: 'Railway',
      description: '铁路相关影像，包括列车、车站、线路设施等',
      icon: '🚆',
    },
    {
      id: 'automobile',
      name: '汽车',
      name_en: 'Automobile',
      description: '汽车及其他地面交通相关影像',
      icon: '🚗',
    },
  ];

  for (const cat of categories) {
    await tagsDb.run(
      'INSERT INTO tag_categories (id, name, name_en, description, icon) VALUES (?, ?, ?, ?, ?)',
      cat.id, cat.name, cat.name_en, cat.description, cat.icon
    );
  }

  const aviationObjects: TagObject[] = [
    { id: 'av_flight', category_id: 'aviation', name: '飞行器', name_en: 'Aircraft', description: '各类民用飞行器' },
    { id: 'av_airport', category_id: 'aviation', name: '机场设施', name_en: 'Airport', description: '机场建筑及设施' },
    { id: 'av_ground', category_id: 'aviation', name: '地勤车辆', name_en: 'GroundSupport', description: '机场地勤保障车辆' },
    { id: 'av_service', category_id: 'aviation', name: '服务场景', name_en: 'Service', description: '机场服务与人文场景' },
    { id: 'av_culture', category_id: 'aviation', name: '航空文化', name_en: 'AviationCulture', description: '航展、博物馆等文化活动' },
  ];

  const railwayObjects: TagObject[] = [
    { id: 'rw_train', category_id: 'railway', name: '列车类型', name_en: 'Train', description: '各类列车及轨道交通' },
    { id: 'rw_station', category_id: 'railway', name: '车站设施', name_en: 'Station', description: '车站建筑及设施' },
    { id: 'rw_infrastructure', category_id: 'railway', name: '线路设施', name_en: 'Infrastructure', description: '铁路线路及技术设施' },
    { id: 'rw_maintenance', category_id: 'railway', name: '工程检修', name_en: 'Maintenance', description: '工程车辆及检修作业' },
    { id: 'rw_culture', category_id: 'railway', name: '铁路文化', name_en: 'RailwayCulture', description: '铁路博物馆及文化活动' },
  ];

  const automobileObjects: TagObject[] = [
    { id: 'au_bus', category_id: 'automobile', name: '公共汽车', name_en: 'Bus', description: '城市公交及长途客车' },
    { id: 'au_car', category_id: 'automobile', name: '乘用车', name_en: 'PassengerCar', description: '轿车、SUV、MPV等' },
    { id: 'au_commercial', category_id: 'automobile', name: '商用车辆', name_en: 'Commercial', description: '货车、特种车辆等' },
    { id: 'au_two_wheeled', category_id: 'automobile', name: '两轮交通', name_en: 'TwoWheeled', description: '自行车、摩托车等' },
    { id: 'au_water', category_id: 'automobile', name: '水上交通', name_en: 'WaterTransport', description: '船舶及水上交通工具' },
    { id: 'au_hub', category_id: 'automobile', name: '交通枢纽', name_en: 'TransportHub', description: '立交桥、隧道等基础设施' },
  ];

  for (const obj of [...aviationObjects, ...railwayObjects, ...automobileObjects]) {
    await tagsDb.run(
      'INSERT INTO tag_objects (id, category_id, name, name_en, description) VALUES (?, ?, ?, ?, ?)',
      obj.id, obj.category_id, obj.name, obj.name_en, obj.description
    );
  }

  const aviationAttributes: TagAttribute[] = [
    { id: 'av_flight_model', object_id: 'av_flight', key: '机型', key_en: 'model', label: '机型', type: 'text' },
    { id: 'av_flight_type', object_id: 'av_flight', key: '机型类型', key_en: 'type', label: '机型类型', type: 'select', options: JSON.stringify(['窄体机', '宽体机', '支线客机', '货机', '公务机', '螺旋桨客机', '直升机', '通用航空']) },
    { id: 'av_flight_reg', object_id: 'av_flight', key: '注册号', key_en: 'registration', label: '注册号', type: 'text' },
    { id: 'av_airport_name', object_id: 'av_airport', key: '机场名称', key_en: 'airport_name', label: '机场名称', type: 'text' },
    { id: 'av_airport_iata', object_id: 'av_airport', key: 'IATA代码', key_en: 'iata_code', label: 'IATA代码', type: 'text' },
    { id: 'av_airport_facility', object_id: 'av_airport', key: '设施类型', key_en: 'facility_type', label: '设施类型', type: 'select', options: JSON.stringify(['航站楼', '塔台', '跑道', '滑行道', '停机坪', '廊桥', '行李转盘']) },
    { id: 'av_ground_type', object_id: 'av_ground', key: '车辆类型', key_en: 'vehicle_type', label: '车辆类型', type: 'select', options: JSON.stringify(['摆渡车', '牵引车', '加油车', '餐食车', '除冰车', '行李拖车', '引导车']) },
    { id: 'av_service_scene', object_id: 'av_service', key: '服务场景', key_en: 'service_scene', label: '服务场景', type: 'select', options: JSON.stringify(['值机', '安检', '免税店', 'VIP休息室', '登机口']) },
    { id: 'av_culture_type', object_id: 'av_culture', key: '文化类型', key_en: 'culture_type', label: '文化类型', type: 'select', options: JSON.stringify(['航展', '航空博物馆', '模拟飞行', '航空周边']) },
  ];

  const railwayAttributes: TagAttribute[] = [
    { id: 'rw_train_type', object_id: 'rw_train', key: '列车类型', key_en: 'train_type', label: '列车类型', type: 'select', options: JSON.stringify(['高速动车', '城际列车', '普速客车', '货运列车', '地铁', '轻轨', '有轨电车', '磁悬浮']) },
    { id: 'rw_train_model', object_id: 'rw_train', key: '列车型号', key_en: 'train_model', label: '列车型号', type: 'text' },
    { id: 'rw_train_line', object_id: 'rw_train', key: '线路名称', key_en: 'line_name', label: '线路名称', type: 'text' },
    { id: 'rw_station_name', object_id: 'rw_station', key: '车站名称', key_en: 'station_name', label: '车站名称', type: 'text' },
    { id: 'rw_station_facility', object_id: 'rw_station', key: '设施类型', key_en: 'facility_type', label: '设施类型', type: 'select', options: JSON.stringify(['站房', '站台', '雨棚', '天桥地道', '候车室', '闸机']) },
    { id: 'rw_infra_type', object_id: 'rw_infrastructure', key: '设施类型', key_en: 'infra_type', label: '设施类型', type: 'select', options: JSON.stringify(['桥梁', '隧道', '道岔', '信号机', '接触网', '轨枕', '道口']) },
    { id: 'rw_maint_type', object_id: 'rw_maintenance', key: '作业类型', key_en: 'maint_type', label: '作业类型', type: 'select', options: JSON.stringify(['接触网作业车', '轨道检测车', '大型养路机械', '调车机车', '救援列车', '除雪车']) },
    { id: 'rw_culture_type', object_id: 'rw_culture', key: '文化类型', key_en: 'culture_type', label: '文化类型', type: 'select', options: JSON.stringify(['铁路博物馆', '观光列车', '蒸汽旅游专列', '车票收藏']) },
  ];

  const automobileAttributes: TagAttribute[] = [
    { id: 'au_bus_type', object_id: 'au_bus', key: '车辆类型', key_en: 'bus_type', label: '车辆类型', type: 'select', options: JSON.stringify(['城市公交', 'BRT快速公交', '双层巴士', '无轨电车', '长途客运', '校车']) },
    { id: 'au_bus_model', object_id: 'au_bus', key: '车辆型号', key_en: 'bus_model', label: '车辆型号', type: 'text' },
    { id: 'au_car_type', object_id: 'au_car', key: '车辆类型', key_en: 'car_type', label: '车辆类型', type: 'select', options: JSON.stringify(['轿车', 'SUV', 'MPV', '跑车', '出租车', '网约车', '房车', '古董车']) },
    { id: 'au_car_brand', object_id: 'au_car', key: '品牌', key_en: 'car_brand', label: '品牌', type: 'text' },
    { id: 'au_car_model', object_id: 'au_car', key: '型号', key_en: 'car_model', label: '型号', type: 'text' },
    { id: 'au_comm_type', object_id: 'au_commercial', key: '车辆类型', key_en: 'comm_type', label: '车辆类型', type: 'select', options: JSON.stringify(['重卡', '轻卡', '集装箱车', '冷链车', '消防车', '救护车', '环卫车']) },
    { id: 'au_comm_model', object_id: 'au_commercial', key: '车辆型号', key_en: 'comm_model', label: '车辆型号', type: 'text' },
    { id: 'au_two_type', object_id: 'au_two_wheeled', key: '车辆类型', key_en: 'two_type', label: '车辆类型', type: 'select', options: JSON.stringify(['自行车', '摩托车', '电动自行车', '共享单车']) },
    { id: 'au_water_type', object_id: 'au_water', key: '船舶类型', key_en: 'water_type', label: '船舶类型', type: 'select', options: JSON.stringify(['客轮', '游轮', '游艇', '拖船', '帆船', '内河驳船']) },
    { id: 'au_hub_type', object_id: 'au_hub', key: '枢纽类型', key_en: 'hub_type', label: '枢纽类型', type: 'select', options: JSON.stringify(['立交桥', '隧道', '停车场', '加油站', '充电桩', '港口码头']) },
  ];

  for (const attr of [...aviationAttributes, ...railwayAttributes, ...automobileAttributes]) {
    await tagsDb.run(
      'INSERT INTO tag_attributes (id, object_id, key, key_en, label, type, options) VALUES (?, ?, ?, ?, ?, ?, ?)',
      attr.id, attr.object_id, attr.key, attr.key_en, attr.label, attr.type, attr.options || null
    );
  }
};

export const initTagsDb = async () => {
  tagsDb = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await tagsDb.run('PRAGMA journal_mode = WAL');
  await tagsDb.run('PRAGMA foreign_keys = ON');

  await initSchema();
  await seedTags();
};
