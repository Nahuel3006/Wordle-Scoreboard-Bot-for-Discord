# Wordle Scoreboard Bot for Discord

[English](README.md)

Bot de Discord para recopilar resultados compartidos de Wordle, mantener estadísticas por jugador y publicar una clasificación por puntos.

## Funciones

- Lee mensajes de resultados en el historial de un canal, en páginas de hasta 100 mensajes.
- Reconoce varios resultados en una misma línea, menciones de Discord y nombres escritos como texto.
- Acumula partidas, victorias, intentos, puntos y conteos de `1/6` a `X/6`.
- Fusiona nombres de usuario con IDs de Discord cuando puede asociarlos sin ambigüedad.
- Ordena por puntos acumulados; los empates comparten posición.
- Puede recalcular el historial desde un mensaje indicado o actualizarse desde el último checkpoint.
- Puede vigilar un canal y publicar resultados al detectar mensajes nuevos de Wordle.

## Puntuación

| Resultado | Puntos |
| --- | ---: |
| `1/6` | 6 |
| `2/6` | 5 |
| `3/6` | 4 |
| `4/6` | 3 |
| `5/6` | 2 |
| `6/6` | 1 |
| `X/6` | 0 |

El ranking usa el total de puntos. Cada fila también muestra cuántas veces obtuvo cada resultado.

## Requisitos

- Node.js 18 o posterior.
- Una aplicación y un bot creados en el [Discord Developer Portal](https://discord.com/developers/applications).
- Acceso de lectura al historial del canal de origen y permiso para enviar mensajes en el canal de salida.
- El intent **Message Content** habilitado para el bot en el Developer Portal.

## Configuración

1. Instala dependencias con `npm ci`.
2. Copia `.env.example` como `.env`.
3. Configura `DISCORD_TOKEN` y `CLIENT_ID` en `.env`.
4. Invita el bot al servidor con los scopes `bot` y `applications.commands`, y los permisos necesarios para ver canales, leer historial y enviar mensajes.
5. Inicia el bot con `node index.js`.

No publiques el archivo `.env` ni compartas el token del bot.

## Comandos

### `/obtenerresultados`

Revisa un canal y publica la clasificación en el canal de origen o en el canal de salida indicado.

- `canal`: canal cuyo historial se procesa.
- `canal2`: canal opcional donde publicar el ranking.
- `recalcular`: reconstruye las estadísticas en vez de continuar desde el checkpoint guardado.
- `desde_id`: ID inclusivo del primer mensaje que se debe contar.

Para obtener conteos exactos de cada resultado desde un punto concreto, usa `recalcular: true` junto con `desde_id`. El recálculo reemplaza las estadísticas guardadas por las del intervalo desde ese mensaje hasta el más reciente. Si se proporciona `desde_id` sin recalcular, los mensajes se suman a las estadísticas actuales; no lo uses para volver a procesar un intervalo que ya fue contabilizado.

El JSON local se escribe al terminar el recorrido. Si el proceso falla antes, conserva el archivo anterior.

### `/rastrear`

Guarda un canal de origen y otro de salida. Cuando llega un mensaje nuevo que parece ser un resultado de Wordle, el bot actualiza las estadísticas y publica la clasificación.

## Datos y pruebas

Las estadísticas y el checkpoint se guardan en `wordle_stats.json`. Ese archivo contiene datos mutables e IDs de usuarios, por lo que está excluido de Git. Los conteos detallados no se pueden reconstruir desde agregados antiguos; se completan al recalcular el historial.

Ejecuta la suite local con:

```sh
npm test
```

Las pruebas cubren el parser, la paginación, la migración de estadísticas, las alias, el ranking y los límites de los embeds.