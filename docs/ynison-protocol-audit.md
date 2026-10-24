# Ynison — аудит протокола

**Статус:** подтверждено сравнение исходников сторонних клиентов. Реальный WebSocket-handshake официального веб-плеера пока не получен, поэтому параметры официального клиента НЕ выдаются за известные.

## Подтверждённые различия

| Параметр | Python MarshalX | JavaScript @dvxch | .NET jrfrigat |
| --- | --- | --- | --- |
| Redirector | wss://ynison.music.yandex.ru/redirector.YnisonRedirectService/GetRedirectToYnison | То же | То же |
| State | wss://{host}/ynison_state.YnisonStateService/PutYnisonState | То же | То же |
| Origin | https://music.yandex.ru | То же | То же |
| Authorization | OAuth token | То же | То же |
| WS subprotocol | Bearer, v2, URL-encoded JSON | То же | То же |
| Header device.type | 1 (web) | 1 (web) | 1 (web) |
| Header app_name | Python SDK | Node.js SDK | YandexMusic .NET |
| Device ID | 12 hex, стабилен между запусками (получен из токена) | 16 hex, генерируется при новом экземпляре | генерируется SDK |
| Первое сообщение | Betterproto to_dict(), структура protobuf JSON | JS buildUpdateFullStateRequest, camelCase | YnisonRequests.CreateUpdateFullStateRequest |
| Реконнекты | Поддерживает, в Pulse пока выключен | Поддерживает, в диагностике reconnect:false | Поддерживает |

**Источники кода:**
- Python: https://github.com/MarshalX/yandex-music-api/blob/main/yandex_music/ynison/_base.py и https://github.com/MarshalX/yandex-music-api/blob/main/yandex_music/ynison/messages.py
- JS: https://github.com/thedvxch/yandex-music/blob/main/src/ynison/client.ts и https://github.com/thedvxch/yandex-music/blob/main/src/ynison/messages.ts
- .NET: https://github.com/jrfrigat/YandexMusic/blob/main/src/YandexMusic.Ynison/YnisonClient.Connection.cs

Все три используют redirector → state. JS и Python в нашей диагностике получают отказ от сервера состояния и длительную паузу. Это НЕ доказывает глобальный сбой Ynison.

## Проверяем официальный веб-плеер

1. На своём компьютере в Chrome или Яндекс Браузере открой https://music.yandex.ru, войди в аккаунт.
2. Нажми F12 → Network / Сеть → фильтр WS; включи Preserve log.
3. Обнови страницу музыки и начни воспроизведение. Посмотри, появилось ли соединение с Ynison. Если такого соединения нет, нельзя считать отсутствие ошибки доказательством успеха.
4. В DevTools экспортируй HAR. Выбирай sanitized HAR, если браузер предлагает. **Никому не отправляй исходный HAR**, даже если он sanitized: запросы могут содержать секреты и персональные данные.
5. Открой https://okelii77.github.io/yandex-pulse/ynison-audit.html и выбери HAR в локальном анализаторе. Он ничего не отправляет на сервер.
6. Отправь в чат только сформированную очищенную сводку, не HAR.

Аудитор берёт только: вид handshake, разрешённый код HTTP, наличие заголовков Cookie и Authorization, категорию схемы OAuth, совпадение Origin с официальным, присутствие протокола v2, нормализованные поля типа/app_name устройства, наличие ticket/session. Он **не выводит** их значения, запросы, URL, треки, ID или токены. Тест конфиденциальности — monitor/ynison_alt/test-har-core.mjs.

**Ограничение:** sanitized HAR может убрать Authorization, Cookie и другие заголовки, поэтому отсутствие заголовка в экспортированном файле НЕ доказывает его отсутствие в живом WebSocket. Если в HAR нет WebSocket, это не обязательно означает отсутствие WebSocket в браузере — проверь фильтр и экспорт.

## Что выясняем после сравнения

- Официальный клиент действительно устанавливает WebSocket с Ynison?
- Его авторизация основана на OAuth-заголовке или на cookie/другом механизме?
- Отличаются ли app_name, device_type, subprotocol, Origin между стадиями?
- Есть ли redirect ticket на втором этапе, приходит ли HTTP 101 на обоих?

При выявлении различий исследуем только те, которые подтверждаются реальными данными. Не перебираем наборы Client ID и не делаем частые повторные подключения после сообщения сервера go-away.
