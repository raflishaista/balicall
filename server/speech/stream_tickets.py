"""Single-use meeting tickets. This module does not load an ASR engine."""
import base64
import hashlib
import hmac
import json
import time


class TicketVerifier:
    def __init__(self, secret, model, limit=4096):
        self.secret, self.model, self.limit = secret, model, limit
        self.used = {}

    def verify(self, ticket, now=None):
        now = time.time() if now is None else now
        try:
            if len(self.secret) < 32 or not isinstance(ticket,str) or len(ticket)>8192:
                raise ValueError('Invalid ticket')
            payload, signature = ticket.split('.')
            expected = base64.urlsafe_b64encode(hmac.new(self.secret.encode(),payload.encode(),hashlib.sha256).digest()).decode().rstrip('=')
            if not hmac.compare_digest(signature,expected): raise ValueError('Invalid signature')
            data=json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))
            if (type(data.get('exp')) not in (int,float) or not now<data['exp']<=now+65
                or data.get('model')!=self.model or data.get('language') not in ('id','en')
                or type(data.get('diarize',False)) is not bool): raise ValueError('Invalid session')
            for field in ('nonce','meetingId','speakerId'):
                if not isinstance(data.get(field),str) or not 1<=len(data[field])<=200: raise ValueError('Missing identity')
            self.used={key:expiry for key,expiry in self.used.items() if expiry>now}
            if data['nonce'] in self.used or len(self.used)>=self.limit: raise ValueError('Used ticket or capacity exceeded')
            self.used[data['nonce']]=data['exp']
            return data
        except (KeyError,TypeError,UnicodeError,json.JSONDecodeError) as error:
            raise ValueError('Invalid ticket') from error
