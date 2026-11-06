import { createHmac, randomBytes, randomUUID, timingSafeEqual, createPublicKey, verify } from 'node:crypto';

export function localAuth(secret = randomBytes(32).toString('hex')) {
  const sign = input => createHmac('sha256', secret).update(input).digest('base64url');
  return {
    issue(user) {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ sub: user.id, jti: randomUUID(), iss: 'kenma-scout-local', token_use: 'access', exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url');
      return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
    },
    async verify(token) {
      try {
        const [header, payload, signature, extra] = token.split('.');
        if (extra || !header || !payload || !signature) throw Error();
        const expected = Buffer.from(sign(`${header}.${payload}`)); const actual = Buffer.from(signature);
        const head = JSON.parse(Buffer.from(header, 'base64url'));
        const claims = JSON.parse(Buffer.from(payload, 'base64url'));
        if (head.alg !== 'HS256' || actual.length !== expected.length || !timingSafeEqual(actual, expected) || claims.iss !== 'kenma-scout-local' || claims.exp <= Date.now()/1000 || !claims.sub) throw Error();
        return claims.sub;
      } catch { throw Object.assign(Error('Token inválido o caducado. Inicia sesión de nuevo.'), { status: 401 }); }
    }
  };
}

// Cognito firma con RS256. Validamos firma, emisor, expiración, uso y app client.
export function cognitoAuth({ region, userPoolId, clientId }) {
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  let keys = []; let fetchedAt = 0;
  return {
    async login(username, password) {
      const response = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
        body: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: username, PASSWORD: password } }), signal: AbortSignal.timeout(8000)
      });
      const result = await response.json();
      if (!response.ok || !result.AuthenticationResult) throw Object.assign(Error('Credenciales incorrectas o usuario pendiente de configurar.'), { status: 401 });
      return result.AuthenticationResult.AccessToken;
    },
    async verify(token) {
      try {
        const [h,p,s,extra] = token.split('.'); if (extra || !h || !p || !s) throw Error();
        const head = JSON.parse(Buffer.from(h,'base64url')); const claims = JSON.parse(Buffer.from(p,'base64url'));
        if (head.alg !== 'RS256' || claims.iss !== issuer || claims.token_use !== 'access' || claims.client_id !== clientId || !claims.exp || claims.exp <= Date.now()/1000 || !claims.username) throw Error();
        if (Date.now()-fetchedAt > 3600000 || !keys.some(k => k.kid === head.kid)) {
          const response = await fetch(`${issuer}/.well-known/jwks.json`, { signal: AbortSignal.timeout(5000) });
          if (!response.ok) throw Error(); keys = (await response.json()).keys; fetchedAt = Date.now();
        }
        const jwk = keys.find(key => key.kid === head.kid); if (!jwk) throw Error();
        if (!verify('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format:'jwk' }), Buffer.from(s,'base64url'))) throw Error();
        return claims.username;
      } catch { throw Object.assign(Error('Token de Cognito inválido o caducado.'), { status: 401 }); }
    }
  };
}
