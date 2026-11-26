import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { crearServicioFotos, fotosDeEntorno, leerImagen, limpiarFotos, urlDeFotoValida } from "../src/fotos.js";
import { crearDrive } from "../src/drive.js";

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40, 2)]);
const dataUrl = (b, tipo = "image/jpeg") => `data:${tipo};base64,${b.toString("base64")}`;

describe("fotos: validación", () => {
  it("acepta JPG, PNG y WebP reales (por su contenido, no por lo que diga el tipo)", () => {
    assert.deepEqual([leerImagen(dataUrl(JPG)).mime, leerImagen(dataUrl(png, "image/x")).mime], ["image/jpeg", "image/png"]);
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(20)]);
    assert.equal(leerImagen(dataUrl(webp)).ext, "webp");
    assert.equal(leerImagen(JPG.toString("base64")).mime, "image/jpeg"); // base64 pelado
  });
  it("rechaza lo que no es imagen, lo vacío y lo muy pesado", () => {
    for (const malo of [dataUrl(Buffer.from("<script>alert(1)</script>"), "image/jpeg"), "", null, dataUrl(Buffer.alloc(3))])
      assert.throws(() => leerImagen(malo), (e) => e.codigo === "FOTO_INVALIDA");
    assert.throws(() => leerImagen(dataUrl(Buffer.concat([JPG, Buffer.alloc(4 * 1024 * 1024)]))), (e) => e.codigo === "FOTO_GRANDE");
  });
  it("solo se guardan URLs de Drive con la forma que genera este servicio", () => {
    const ok = "https://drive.google.com/uc?export=view&id=1AbC_dEf-gHiJkL";
    assert.equal(urlDeFotoValida(ok), true);
    for (const mala of ["http://drive.google.com/uc?export=view&id=1AbC_dEf-gHiJkL", "https://evil.com/uc?export=view&id=1AbC_dEf-gHiJkL", `${ok}&x=1`, "https://drive.google.com/uc?export=view&id=a", null, 5])
      assert.equal(urlDeFotoValida(mala), false);
    assert.deepEqual(limpiarFotos([ok, ok, "https://x.com/a"], 5), [ok]);
    assert.deepEqual(limpiarFotos(Array.from({ length: 9 }, (_, i) => `https://drive.google.com/uc?export=view&id=${String(i).repeat(12)}`), 5).length, 5);
    assert.deepEqual(limpiarFotos("no es lista"), []);
  });
});

describe("fotos: Drive", () => {
  function llamadas({ rechazarSubida = false } = {}) {
    const reg = [];
    const fetch = async (url, op = {}) => {
      reg.push({ url: String(url), op });
      if (String(url).includes("oauth2")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
      if (String(url).includes("/upload/")) return rechazarSubida ? { ok: false, status: 403, json: async () => ({ error: { message: "Service Accounts do not have storage quota." } }) } : { ok: true, json: async () => ({ id: "ARCHIVO12345" }) };
      return { ok: true, json: async () => ({}) };
    };
    return { reg, fetch };
  }
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });

  it("sube a la carpeta, la deja visible con el enlace y devuelve la URL", async () => {
    const { reg, fetch } = llamadas();
    const drive = crearDrive({ carpetaId: "CARPETA1", servicio: { email: "svc@x.iam", clave: pem }, fetch });
    const r = await drive.subir({ nombre: "f.jpg", mime: "image/jpeg", bytes: JPG });
    assert.deepEqual(r, { id: "ARCHIVO12345", url: "https://drive.google.com/uc?export=view&id=ARCHIVO12345" });
    const subida = reg.find((x) => x.url.includes("/upload/"));
    assert.match(subida.url, /supportsAllDrives=true/);
    assert.equal(subida.op.headers.authorization, "Bearer tok");
    assert.match(subida.op.headers["content-type"], /^multipart\/related; boundary=/);
    const texto = subida.op.body.toString("latin1");
    assert.ok(texto.includes('"parents":["CARPETA1"]') && texto.includes('"name":"f.jpg"'));
    assert.ok(subida.op.body.includes(JPG));
    const permiso = reg.find((x) => x.url.includes("/permissions"));
    assert.match(permiso.url, /files\/ARCHIVO12345\/permissions/);
    assert.deepEqual(JSON.parse(permiso.op.body), { role: "reader", type: "anyone" });
  });
  it("con OAuth de usuario pide el token con el refresh token (Drive personal)", async () => {
    const { reg, fetch } = llamadas();
    const drive = crearDrive({ carpetaId: "C", oauth: { clientId: "id", clientSecret: "sec", refreshToken: "rt" }, fetch });
    await drive.subir({ nombre: "f.jpg", mime: "image/jpeg", bytes: JPG });
    const cuerpo = reg[0].op.body;
    assert.deepEqual([cuerpo.get("grant_type"), cuerpo.get("refresh_token"), cuerpo.get("client_id")], ["refresh_token", "rt", "id"]);
  });
  it("un rechazo de Google llega con su explicación", async () => {
    const { fetch } = llamadas({ rechazarSubida: true });
    const drive = crearDrive({ carpetaId: "C", servicio: { email: "s", clave: pem }, fetch });
    await assert.rejects(drive.subir({ nombre: "f.jpg", mime: "image/jpeg", bytes: JPG }), /storage quota/);
  });
});

describe("fotos: servicio y entorno", () => {
  const falso = (sube = []) => ({ async subir(a) { sube.push(a); return { id: "ID1234567890", url: "https://drive.google.com/uc?export=view&id=ID1234567890" }; } });
  it("sin Drive configurado dice que están apagadas", async () => {
    const s = crearServicioFotos({});
    assert.equal(s.activo, false);
    await assert.rejects(s.subir({ usuarioId: "u", imagen: dataUrl(JPG) }), (e) => e.codigo === "FOTOS_NO_CONFIGURADAS");
  });
  it("valida, nombra el archivo sin datos de la persona y limita las subidas por hora", async () => {
    const sube = []; let t = Date.UTC(2026, 10, 25, 12, 30, 5);
    const s = crearServicioFotos({ drive: falso(sube), ahora: () => t, azar: () => "abc123" });
    const r = await s.subir({ usuarioId: "u1", imagen: dataUrl(JPG) });
    assert.equal(r.url, "https://drive.google.com/uc?export=view&id=ID1234567890");
    assert.equal(sube[0].nombre, "topd-20261125-123005-abc123.jpg");
    assert.equal(sube[0].mime, "image/jpeg");
    await assert.rejects(s.subir({ usuarioId: "u1", imagen: dataUrl(Buffer.from("texto largo de prueba")) }), (e) => e.codigo === "FOTO_INVALIDA");
    for (let i = 0; i < 149; i++) await s.subir({ usuarioId: "u1", imagen: dataUrl(JPG) });
    await assert.rejects(s.subir({ usuarioId: "u1", imagen: dataUrl(JPG) }), (e) => e.codigo === "LIMITE_FOTOS");
    await s.subir({ usuarioId: "u2", imagen: dataUrl(JPG) }); // otra persona, no afecta
    t += 3600001;
    await s.subir({ usuarioId: "u1", imagen: dataUrl(JPG) }); // pasó la hora
  });
  it("variables de entorno: carpeta + (OAuth o cuenta de servicio); si falta algo, apagadas", () => {
    const sa = { GOOGLE_SERVICE_ACCOUNT_EMAIL: "a@b.c", GOOGLE_PRIVATE_KEY: "k" };
    assert.deepEqual(fotosDeEntorno({ TOPD_FOTOS_CARPETA_ID: "F", ...sa }), { carpetaId: "F", servicio: { email: "a@b.c", clave: "k" } });
    const oa = { GOOGLE_OAUTH_CLIENT_ID: "i", GOOGLE_OAUTH_CLIENT_SECRET: "s", GOOGLE_OAUTH_REFRESH_TOKEN: "r" };
    assert.deepEqual(fotosDeEntorno({ TOPD_FOTOS_CARPETA_ID: "F", ...sa, ...oa }), { carpetaId: "F", oauth: { clientId: "i", clientSecret: "s", refreshToken: "r" } }); // OAuth manda
    assert.equal(fotosDeEntorno(sa), null);
    assert.equal(fotosDeEntorno({ TOPD_FOTOS_CARPETA_ID: "F" }), null);
    assert.equal(fotosDeEntorno({ TOPD_FOTOS_CARPETA_ID: "F", ...sa, TOPD_FOTOS_APAGADO: "1" }), null);
  });
});
