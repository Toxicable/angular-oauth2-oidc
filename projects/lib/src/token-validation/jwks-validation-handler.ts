import {
  AbstractValidationHandler,
  ValidationParams
} from './validation-handler';

/**
 * Validates the signature of an id_token against one
 * of the keys of an JSON Web Key Set (jwks).
 *
 * This jwks can be provided by the discovery document.
 */
export class JwksValidationHandler extends AbstractValidationHandler {
  /**
   * Allowed algorithms
   */
  allowedAlgorithms: string[] = [
    'HS256',
    'HS384',
    'HS512',
    'RS256',
    'RS384',
    'RS512',
    'ES256',
    'ES384',
    'PS256',
    'PS384',
    'PS512'
  ];

  /**
   * Time period in seconds the timestamp in the signature can
   * differ from the current time.
   */
  gracePeriodInSec = 600;

  private cyptoObj: Crypto = window.crypto || (window as any).msCrypto // for IE11
  private textEncoder = new (window as any).TextEncoder();

  async validateSignature(params: ValidationParams, retry = false): Promise<any> {
    if (!params.idToken) throw new Error('Parameter idToken expected!');
    if (!params.idTokenHeader)
      throw new Error('Parameter idTokenHandler expected.');
    if (!params.jwks) throw new Error('Parameter jwks expected!');

    if (
      !params.jwks['keys'] ||
      !Array.isArray(params.jwks['keys']) ||
      params.jwks['keys'].length === 0
    ) {
      throw new Error('Array keys in jwks missing!');
    }

    let kid: string = params.idTokenHeader['kid'];
    let keys: JsonWebKey[] = params.jwks['keys'];
    let key: JsonWebKey;

    let alg = params.idTokenHeader['alg'];

    if (kid) {
      key = keys.find(k => k['kid'] === kid /* && k['use'] === 'sig' */);
    } else {
      let kty = this.alg2kty(alg);
      let matchingKeys = keys.filter(
        k => k['kty'] === kty && k['use'] === 'sig'
      );

      if (matchingKeys.length > 1) {
        let error =
          'More than one matching key found. Please specify a kid in the id_token header.';
        console.error(error);
        return Promise.reject(error);
      } else if (matchingKeys.length === 1) {
        key = matchingKeys[0];
      }
    }

    if (!key && !retry && params.loadKeys) {
      return params
        .loadKeys()
        .then(loadedKeys => (params.jwks = loadedKeys))
        .then(_ => this.validateSignature(params, true));
    }

    if (!key && retry && !kid) {
      let error = 'No matching key found.';
      console.error(error);
      return Promise.reject(error);
    }

    if (!key && retry && kid) {
      let error =
        'expected key not found in property jwks. ' +
        'This property is most likely loaded with the ' +
        'discovery document. ' +
        'Expected key id (kid): ' +
        kid;

      console.error(error);
      return Promise.reject(error);
    }

    const [header, body, sig] = params.idToken.split(',');

    const cyptokey = await this.cyptoObj.subtle.importKey('jwk', key as any, alg, true, ['verify']);
    const isValid = await this.cyptoObj.subtle.verify(alg, cyptokey, this.textEncoder.encode(sig), this.textEncoder.encode(body));

    if(isValid) {
      return Promise.resolve();
    }else {
      return Promise.reject('Signature not valid');
    }
  }

  private alg2kty(alg: string) {
    switch (alg.charAt(0)) {
      case 'R':
        return 'RSA';
      case 'E':
        return 'EC';
      default:
        throw new Error('Cannot infer kty from alg: ' + alg);
    }
  }

  async calcHash(valueToHash: string, algorithm: string): Promise<string> {
    const valueAsBytes = this.textEncoder.encode(valueToHash);
    const resultBytes = await this.cyptoObj.subtle.digest(algorithm, valueAsBytes);
    // the returned bytes are encoded as UTF-16
    return String.fromCharCode.apply(null, new Uint16Array(resultBytes));
  }

  toByteArrayAsString(hexString: string) {
    let result = '';
    for (let i = 0; i < hexString.length; i += 2) {
      let hexDigit = hexString.charAt(i) + hexString.charAt(i + 1);
      let num = parseInt(hexDigit, 16);
      result += String.fromCharCode(num);
    }
    return result;
  }
}
