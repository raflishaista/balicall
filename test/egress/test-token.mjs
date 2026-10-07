import { AccessToken } from 'livekit-server-sdk';

const token = new AccessToken('devkey', 'c35dce5eb68185c1ba3b140ab408da916a75c0d297f42c96cbbe5aa362f7b082', {
  identity: 'test-user',
});

token.addGrant({
  roomJoin: true,
  room: 'egress-test-room',
});

console.log(await token.toJwt());
