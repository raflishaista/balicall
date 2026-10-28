"""Conservative SEA word attribution using immutable closed diarizer turns."""

UNKNOWN=('Pembicara belum diketahui','unknown')
OVERLAP=('Suara bertumpuk','overlap')


class WordAttributor:
    def __init__(self):
        self.turns=[]
        self.watermark=0

    def add_turns(self,turns,received_samples):
        if not isinstance(turns,list) or len(turns)>4096:raise ValueError('Invalid diarizer turns')
        checked=[];previous=self.watermark
        for turn in turns:
            if not isinstance(turn,dict):raise ValueError('Invalid diarizer turn')
            start,end=turn.get('startSample'),turn.get('endSample')
            label,attribution=turn.get('speakerLabel'),turn.get('attribution')
            if (type(start) is not int or type(end) is not int or not previous<=start<end<=received_samples
                    or attribution not in ('assigned','unknown','overlap')
                    or not isinstance(label,str) or not label.strip() or len(label)>100):
                raise ValueError('Invalid or revised diarizer turn')
            checked.append((start,end,label,attribution));previous=end
        self.turns.extend(checked)
        self.watermark=previous

    def label(self,start,end):
        matches=[turn for turn in self.turns if turn[0]<end and turn[1]>start]
        if any(turn[3]=='overlap' for turn in matches):return OVERLAP
        cursor=start;label=None
        for begin,stop,speaker,attribution in matches:
            if begin>cursor or attribution!='assigned' or (label is not None and label!=speaker):return UNKNOWN
            label=speaker;cursor=max(cursor,min(stop,end))
        return (label,'assigned') if label and cursor>=end else UNKNOWN

    def prune(self,before):
        self.turns=[turn for turn in self.turns if turn[1]>before]
