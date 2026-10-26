export function recordingDownloadName(response: Pick<Response,'headers'>, meetingId: string): string {
  const extension = response.headers.get('content-type')?.toLowerCase().includes('audio/ogg') ? 'ogg' : 'mp4';
  const disposition = response.headers.get('content-disposition') || '';
  const fileName = /filename="([^"\r\n]+)"/i.exec(disposition)?.[1];
  if (fileName && /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(fileName) && fileName.toLowerCase().endsWith(`.${extension}`)) return fileName;
  const safeId = meetingId.replace(/^meeting-/, '').replace(/[^a-zA-Z0-9_-]/g,'_');
  return `balicall-recording-${safeId}.${extension}`;
}
