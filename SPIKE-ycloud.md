# Spike YCloud — contrato de integración

> Paso 0 de la secuencia endurecida (BLUEPRINT §14): *"spike real de YCloud
> (enviar/recibir 1 mensaje: endpoint de envío + firma + shape inbound) antes de
> construir encima"*.
>
> **Estado:** contrato documentado a partir de una integración funcionando.
> **Falta la prueba en vivo** con el número real; ver "Pendiente" al final.

---

## 1. API REST

| | |
| --- | --- |
| Base | `https://api.ycloud.com/v2` |
| Autenticación | Cabecera **`X-API-Key: {apiKey}`** — no `Authorization: Bearer` |
| Enviar mensaje | `POST /whatsapp/messages` |
| Plantillas | `GET` / `POST /whatsapp/templates` |
| Números del canal | `GET /whatsapp/phoneNumbers` |

### Enviar un texto

```
POST https://api.ycloud.com/v2/whatsapp/messages
X-API-Key: {apiKey}
Content-Type: application/json

{
  "type": "text",
  "from": "{numeroDelWorkspace E.164}",
  "to":   "{numeroDelContacto E.164}",
  "text": { "body": "…" }
}
```

La respuesta trae **`id`, `wamid` y `status`**. El `wamid` es el identificador
de Meta y es el que se guarda en `messages.wamid` para la idempotencia de salida
(BLUEPRINT §6.3).

> Crear plantillas por API requiere `wabaId`, que no viene en los números. Si se
> necesita, hay que obtenerlo aparte.

---

## 2. Webhook de entrada

### Firma — así se verifica

La cabecera de firma tiene este formato:

```
t={segundosUnix},s={hmacSha256EnHex}
```

Y lo que se firma es:

```
HMAC-SHA256( secreto ,  timestamp + "." + cuerpoCrudo )
```

Tres cosas que hay que respetar, y las tres son de seguridad:

1. **El cuerpo tiene que ser el crudo**, tal cual llegó. Si se parsea a JSON y se
   vuelve a serializar, la firma deja de coincidir: cambia el orden de las claves
   o los espacios.
2. **Ventana antirreplay de 300 segundos.** Si el timestamp se aleja más de eso
   del momento actual, se rechaza. Sin esto, alguien que capture una petición
   válida puede reenviarla indefinidamente.
3. **Comparación en tiempo constante** (`timingSafeEqual`). Comparar con `===`
   filtra información: cuanto más acierta el atacante, más tarda en fallar, y con
   suficientes intentos se deduce la firma carácter a carácter.

### Evento de mensaje entrante

```
event.type  ===  "whatsapp.inbound_message.received"
```

- El contenido va en **`event.whatsappInboundMessage`**, con `wamid` y `type`.
- La marca de tiempo va en la raíz: **`event.createTime`** (ISO).
- **Hay que descartar los eventos de eco** (los que llevan `echo` en el tipo):
  son los mensajes salientes rebotados, y procesarlos duplicaría todo.

---

## 2.b Una URL de webhook por workspace

**Cada workspace tiene su propia URL de webhook, con su identificador dentro.**

**Decidido en F1: el identificador va en la ruta, no en la query.**

```
/api/webhooks/ycloud/{workspaceId}
```

Es la forma que ya figuraba en la estructura de carpetas del blueprint §17, y
además evita un problema práctico de este equipo: PowerShell parte los
argumentos nativos por el `=`, así que una URL con `?wsid=…` se rompe al pegarla
en un comando.

No es un adorno: **es lo que permite verificar la firma.** Cuando llega una
petición hay que saber con qué secreto comprobarla, y ese secreto es distinto
por cliente. Averiguar de quién es mirando el cuerpo no vale — del cuerpo no
puede uno fiarse hasta *después* de verificar la firma. El identificador en la
URL rompe ese círculo.

Y no debilita la seguridad: alguien que adivine un `wsid` sigue sin poder
falsificar una firma válida, porque no tiene el secreto. El identificador dice
*con qué llave mirar*, no abre nada.

La alternativa —un único secreto para todos los workspaces— se descarta: la
fuga del secreto de un cliente comprometería a todos.

### Un secreto por workspace, no por canal

Hay un segundo círculo, un nivel más abajo, que apareció al implementar F1:
`webhook_secret_ref` vive en `channels`, y si un workspace tuviera dos canales
con secretos distintos, tampoco habría forma de saber cuál usar sin leer el
cuerpo.

Se cierra con el modelo real (§4): **cada cliente tiene una cuenta de YCloud, y
una cuenta configura un webhook con un secreto**. Un workspace = una cuenta = un
secreto. El webhook toma el del único canal activo del workspace y, si
encuentra más de uno, devuelve `409` en vez de adivinar.

**Deuda anotada:** por coherencia, `webhook_secret_ref` debería estar en
`workspaces` y no en `channels`. No se mueve todavía porque implica migración y
no bloquea nada.

## 3. Qué implica para el diseño ya escrito

| Contrato de YCloud | Dónde encaja en el blueprint |
| --- | --- |
| `wamid` en la respuesta y en el inbound | `UNIQUE(workspace_id, wamid)` en `messages` (§6.3) |
| El evento trae su propio identificador | `processed_events` para la idempotencia (§6.1) |
| La firma exige el cuerpo crudo | El webhook debe leer el body **antes** de parsearlo |
| Ventana de 300 s | Reforzada por la comprobación de firma, no sustituida |
| `X-API-Key` por workspace | `channels.ycloud_credential_ref` → Vault (§7) |

---

## 4. Pendiente

- [ ] **Prueba en vivo**: enviar y recibir un mensaje real con el número propio,
      y guardar el JSON exacto del inbound. Lo documentado aquí sale de una
      integración que funciona, pero el gate del §14 pide comprobarlo.
- [x] ~~Facturación y sub-cuentas~~ **RESUELTO.** No hay sub-cuentas: **cada
      cliente tiene su propia cuenta de YCloud**, con su API Key y su webhook
      secret, y YCloud le factura a él directamente. Confirma el reparto del
      §7.4: WhatsApp lo paga el cliente, el LLM la agencia (una sola cuenta de
      OpenRouter para toda la plataforma).
- [ ] Formato exacto del inbound para **audio, imagen y documento**, que en F1
      no hacen falta pero llegan en F8.

---

*Contrato de la API de YCloud documentado como referencia. La implementación de
los clientes y del webhook se escribe en este proyecto siguiendo el §5 y el §14
del blueprint.*
