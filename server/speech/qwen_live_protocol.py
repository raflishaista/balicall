"""PCM and final transcript wire contract shared by streaming workers."""
import numpy as np

RATE = 16000
MODEL = 'qwen3-asr-0.6b-live'


def decode_pcm(data):
    if not isinstance(data,bytes) or len(data)%2 or len(data)>64000:
        raise ValueError('Expected PCM16 mono packets up to two seconds')
    return np.frombuffer(data,dtype='<i2').astype(np.float32)/32768


def final_segment(session_id, counter, source_id, text, start, end, speaker, attribution):
    if (type(start) is not int or type(end) is not int or not 0<=start<end
        or attribution not in ('assigned','unknown','overlap')
        or not isinstance(text,str) or not 1<=len(text.strip())<=9000
        or not isinstance(speaker,str) or not 1<=len(speaker)<=100):
        raise ValueError('Invalid final segment')
    return dict(segmentId=f'{session_id}-{counter}', sessionId=session_id,
        sourceId=source_id,text=text.strip(),start=start/RATE,end=end/RATE,
        speakerLabel=speaker,attribution=attribution)


def transcript_frame(interim='', final=None):
    return {'type':'transcript','interim':interim,'final':final or []}
