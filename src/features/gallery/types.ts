export interface PhotoListItem {
  id: string;
  title: string;
  thumbnail_path: string;
  tags: string[];
  width?: number;
  height?: number;
}

export interface PhotoDetail extends PhotoListItem {
  original_url: string;
  preview_url?: string;
  watermarked_url?: string;
  watermark_config?: string;
  created_at: string;
  description: string;
  camera_model: string;
  vehicle: string;
  location: string;
  altitude: number;
  focal_length: string;
  iso: number;
  shutter_speed: string;
  aperture: string;
  likes: number;
  views: number;
}
