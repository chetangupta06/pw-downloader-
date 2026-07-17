const axios = require('axios');

async function test() {
  try {
    const keyUrl = "https://sec-prod-mediacdn.pw.live/4ab9b987-2daa-4153-9f4e-d00fc909c084/hls/enc.key?URLPrefix=aHR0cHM6Ly9zZWMtcHJvZC1tZWRpYWNkbi5wdy5saXZlLzRhYjliOTg3LTJkYWEtNDE1My05ZjRlLWQwMGZjOTA5YzA4NA&Expires=1780574560&KeyName=pw-prod-key&Signature=BEewLGe_RkT80tw8PNlvzSAMgDZFPQJznsK4J5tV7kI5jKGC0NGBNkH7XOTHLZexC7MJstvmXTN4-4sKaiq8Dg";
    const res = await axios.get(keyUrl, { responseType: 'arraybuffer' });
    console.log("Success! Length:", res.data.length);
  } catch(e) {
    console.log("Error:", e.response ? e.response.status : e.message);
  }
}
test();
