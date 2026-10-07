import { EgressClient } from 'livekit-server-sdk';

const egress = new EgressClient(
  'http://127.0.0.1:7880',
  'devkey',
  'c35dce5eb68185c1ba3b140ab408da916a75c0d297f42c96cbbe5aa362f7b082'
);

const result = await egress.startRoomCompositeEgress(
  'egress-test-room',
  {
    file: {
      filepath: '/out/egress-test-room.mp4',
      fileType: 1,
    },
  }
);

console.log('Egress ID:', result.egressId);
