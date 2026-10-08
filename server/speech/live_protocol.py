"""Convert cumulative WLK frames into persisted boundaries and interim text."""
class TranscriptFrames:
    def __init__(self):
        self.saved = {}
        self.latest = {}

    def update(self, frame, finish=False):
        self.latest = frame
        lines = frame.get('lines', [])
        final = []
        pending = []
        for index, line in enumerate(lines):
            text = line.get('text', '').strip()
            if not text or line.get('speaker') == -2:
                continue
            key = (line.get('start'), line.get('speaker'))
            saved = self.saved.get(key, '')
            if saved and not text.startswith(saved):
                raise ValueError('Committed WhisperLiveKit text changed unexpectedly')
            remainder = text[len(saved):].strip()
            if not remainder:
                continue
            if finish or index < len(lines) - 1:
                self.saved[key] = text
                # The meeting API limits each saved entry to 10,000 characters.
                final.extend(remainder[offset:offset + 9000] for offset in range(0, len(remainder), 9000))
            else:
                pending.append(remainder)
        if not finish:
            pending.append(frame.get('buffer_transcription', '').strip())
        return {'type': 'transcript', 'final': final, 'interim': ' '.join(filter(None, pending))}
