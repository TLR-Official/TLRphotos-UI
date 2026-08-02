export function getProxyUrl(key: string): string {
  if (key.startsWith('http://') || key.startsWith('https://')) {
    const ossDomain = 'https://tlr-main.oss-cn-hongkong.aliyuncs.com/';
    if (key.startsWith(ossDomain)) {
      const filePath = key.replace(ossDomain, '').split('?')[0];
      return `/api/photos/image/${encodeURIComponent(filePath)}`;
    }
    return key;
  }
  return `/api/photos/image/${encodeURIComponent(key)}`;
}

export function escapeLikePattern(pattern: string): string {
  return pattern.replace(/[%_]/g, '\\$&');
}