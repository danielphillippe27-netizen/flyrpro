// Public WolfGrid media, served from our S3 bucket through the existing CloudFront distribution.
const MEDIA_BASE_URL = 'https://d34c49t0gfk0ai.cloudfront.net/demo-video/site-v1';

export type SiteVideo = {
  src: string;
  poster: string;
  captions?: string;
};

export function siteVideo(name: string, src?: string, poster?: string): SiteVideo {
  return {
    src: src || `${MEDIA_BASE_URL}/${name}.mp4`,
    poster: poster || `${MEDIA_BASE_URL}/${name}.jpg`,
  };
}
