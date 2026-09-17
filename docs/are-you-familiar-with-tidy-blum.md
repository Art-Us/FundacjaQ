# Модуль ресурсів (Zasoby) — інтеграція з мапою та організаціями

## Контекст

Зараз `Resource` у схемі — це статичний, лише для перегляду список, прив'язаний до гміни (не до організації), без часових горизонтів, без зв'язку з `Alert`, без будь-якого workflow розподілу/повернення. Клієнт (за нотатками зустрічей 1/2/4/5) хотів "Macierz Zasobów w Czasie" — таблицю ресурсів організацій за часовими горизонтами (24h/48h/72h/тиждень) з циклом: заявка на потребу → пропозиція ресурсу → погодження доставки → доставлено → погодження повернення → повернуто/не підлягає поверненню, з можливістю часткового повернення та текстовим повідомленням між організаціями.

Мета цього плану: додати цей функціонал (нові моделі, API, сторінку "Matryca Zasobów", інтеграцію в мапу алертів) на основі вашої чернетки, приведеної до технічного вигляду, плюс список того, що чернетка не покривала.

**Рішення, підтверджені вами:**
1. Власник ресурсу — **організація** (`Resource.organizationId`), gmina лишається як похідне географ. поле.
2. Горизонт часу — це **час доступності ресурсу** (кумулятивно: ресурс з горизонтом 24h показується і в колонках 48h/72h/Тиждень).
3. Статусом розподілу керують **обидві сторони**, без окремого кроку "прийняти пропозицію": донор сам оголошує "погоджено доставку"; статус "доставлено" може підтвердити **будь-яка зі сторін** (донор — що відправив, або отримувач — що отримав, залежно хто перший це зробить); а от "погоджено повернення" і фактичне повернення фіксує лише **отримувач** (організація-власник алерту) — оскільки саме він фізично повертає ресурс, коли той йому вже не потрібен.
4. Потрібне **часткове повернення** (наприклад: повернули 3 з 5, 2 пошкоджено) — з журналом подій повернення.
5. Волонтери (`VOLUNTEER`) **не мають доступу** до розділу ресурсів — сторінка "Matryca Zasobów" і всі дії з ресурсами/розподілами доступні лише `ADMIN`/`COORDINATOR` (як і решта адміністративних розділів).
6. Додається **форум алерту** — окрема підсторінка з повною інформацією про алерт і треддом для комунікації між організаціями (донори + організація-власник алерту), відкрита з кнопки на картці алерту.

---

## 1. Структуровані вимоги (з вашої чернетки)

| # | Вимога | Уточнення |
|---|---|---|
| R1 | Кнопка "Повернути ресурси" на картці алерту (мапа + список) | Видима **тільки** організації, що створила алерт, і тільки під алертами цієї організації |
| R2 | Підтвердження розподілу ресурсу | Донор оголошує "погоджено доставку"; "доставлено" може підтвердити **будь-яка сторона** — донор (відправив) або отримувач (отримав); а "погоджено повернення" і фактичне повернення фіксує лише **отримувач** (організація-власник алерту) — бо саме він повертає ресурс, коли той йому вже не потрібен після завершення алерту |
| R3 | Статус під ресурсом/розподілом | 4 статуси з R2 + "не підлягає поверненню" + частковий стан |
| R4 | Повідомлення (необов'язкове) між організаціями | Текстове поле, яке заповнюється разом із поверненням (напр. "повернули частково, X пошкоджено"); повідомлення обов'язково повинно з'являтися на сторінці "Matryca Zasobów" (у панелі сповіщень/дій), а не лише в історії конкретного розподілу |
| R5 | Час повернення ресурсу | Це **не окреме модальне вікно**, а поле (дата/час) прямо в тій самій формі повернення, разом з кількістю та повідомленням — заповнюється вручну одночасно з рештою форми |
| R6 | Алерт прив'язується до організації, що його створила | Зараз організація видно лише через `alert.author.organizationId` — недостатньо надійно |
| R7 | Сповіщення при відкликанні алерту | Якщо алерт скасовано (адміном чи власником), **організація-власник алерту** (отримувач ресурсів) бачить у "Matryca Zasobów" сповіщення + кнопку, що відкриває форму повернення для кожного отриманого нею й ще не повернутого ресурсу; організації-донори отримують інформаційне сповіщення про скасування (без активної дії з їхнього боку) |
| R8 | Таблиця повернення при самостійному скасуванні алерту власником | Перед скасуванням власник заповнює/підтверджує повернення **кожного** отриманого ресурсу (що саме, коли, чи повертається) |
| R9 | Ресурс не завжди повертається (використаний/пошкоджений) | Явний прапорець/кількість "не підлягає поверненню" на рівні розподілу |
| R10 | Сторінка "Matryca Zasobów Ratunkowych" (фото 1) | Плитки-статистика, фільтри категорій, фільтр власника, таблиця тип×горизонт, кнопки "Odśwież" / "**+ Zgłoś nowe zasoby**" — остання відкриває модалку (фото 6) з полями: 1) категорія (4 кнопки: Ludzie/Woda/Sprzęt/Inne — `ResourceGroup`), 2) підкатегорія/назва (випадаючий список `ResourceCategory`/назв в межах обраної групи), 3) кількість + одиниця, 4) горизонт часу (24h/48h/72h/Tydzień) |
| R11 | Інтеграція в сторінку Map (фото 2) | Блок "Zapotrzebowanie na zasoby" на картці алерту: прогрес-бар, "Przydziel zasoby", "Edytuj zapotrzebowanie", "Pokaż kto przekazał", бейдж "Masz zasoby (N)" |
| R12 | Форум алерту (фото 3, 4, 5) | Кнопка "Forum" на картці алерту (у блоці потреб, фото 3) відкриває окрему підсторінку алерту: інформація про алерт (фото 4) + тред-форум під нею (фото 5), де організації-донори й організація-власник алерту можуть вільно листуватися |

---

## 2. Зміни моделі даних (`prisma/schema.prisma`)

### Нові enum'и
```prisma
enum ResourceHorizon { H24 H48 H72 WEEK }        // кумулятивно: H24 ⊂ H48 ⊂ H72 ⊂ WEEK
// Верхньорівневе групування категорій — це саме 4 кнопки з фото 6
// ("Ludzie / Woda / Sprzęt / Inne") і 4 плитки-статистики та фільтр-чіпи на
// фото 1. Кожна конкретна ResourceCategory (Woda pitna, Sprzęt medyczny, ...)
// належить рівно до однієї групи.
enum ResourceGroup { PEOPLE WATER EQUIPMENT OTHER }
enum NeedUrgency { NORMAL PILNE KRYTYCZNY }
enum NeedStatus { OPEN PARTIALLY_FULFILLED FULFILLED CLOSED CANCELLED }
enum AllocationStatus {
  DELIVERY_AGREED      // ДОНОР оголосив, що готує доставку
  DELIVERED            // ДОНОР або ОТРИМУВАЧ підтвердив, що ресурс дійшов (перший, хто відзначить)
  RETURN_AGREED        // тільки ОТРИМУВАЧ ініціює повернення (ресурс йому більше не потрібен)
  PARTIALLY_RETURNED   // частина кількості повернута/визнана неповоротною, частина ще ні
  RETURNED             // все повернуто (або визнано неповоротним) — термінальний
  CANCELLED            // розподіл відкликано до доставки
}
```
Без окремого `PROPOSED`/accept-кроку — донор одразу створює запис у стані `DELIVERY_AGREED`. `DELIVERED` — єдиний перехід, який може виконати **будь-яка зі сторін** (рішення #3); усе після нього (`RETURN_AGREED`, фіксація повернення) виконує лише отримувач (`recipientOrgId` = `alert.organizationId`).

### Змінені моделі
**`ResourceCategory`** — додати:
```prisma
group ResourceGroup @default(OTHER)
```
Існуючі seed-категорії (`Żywność`, `Koce i odzież` → `OTHER`; `Woda pitna` → `WATER`; `Sprzęt medyczny`, `Agregaty prądotwórcze` → `EQUIPMENT`) отримають групу міграцією; додасться й нова категорія для групи `PEOPLE` (`Ludzie / Wolontariusze`), якої в seed зараз немає взагалі.

**`Resource`** — додати:
```prisma
organizationId String
organization   Organization    @relation(fields: [organizationId], references: [id])
horizon        ResourceHorizon @default(H24)
reservedQuantity Int @default(0)   // сума активних (не термінальних) розподілів
@@index([organizationId])
@@index([gminaId, categoryId, horizon])
```
`gminaId` лишається (заповнюється з `organization.gminaId` при створенні, для швидких geo-фільтрів), але UI більше не дає його редагувати напряму.

**`Alert`** — додати:
```prisma
organizationId String?
organization   Organization? @relation(fields: [organizationId], references: [id])
@@index([organizationId])
```
Проставляється з `session.user.organizationId` у `POST /api/alerts`, незмінне після створення. Миграція backfill: `UPDATE "Alert" SET "organizationId" = u."organizationId" FROM "User" u WHERE u.id = "Alert"."authorId"`.

**`Organization`** — додати зворотні релації: `alerts Alert[]`, `resources Resource[]`, `allocationsGiven ResourceAllocation[] @relation("Donor")`.

### Нові моделі

Коротко, навіщо потрібна кожна нова модель, перш ніж дивитися на поля:

- **`AlertNeed`** — конкретна заявлена потреба під алертом ("Zapotrzebowanie na zasoby" з фото 2): "потрібно 6 шт. пландек 10×15, критично". Саме на неї реагують донори, коли натискають "Przydziel zasoby". Без цієї моделі нема на що приділяти ресурс і нема що показувати як прогрес-бар "4/6 шт.".
- **`ResourceAllocation`** — це "серце" всього функціоналу, детальніше пояснення нижче.
- **`AllocationReturnEvent`** — один запис = одна фактична дія повернення. Якщо отримувач повертає ресурс частинами (сьогодні 3 шт., завтра ще 2), кожна така дія — окремий рядок цієї таблиці, зі своєю кількістю, повідомленням і датою. Підсумок усіх рядків одного `ResourceAllocation` визначає, чи він тепер `PARTIALLY_RETURNED` чи повністю `RETURNED`.
- **`AllocationMessage`** — вузьке, "робоче" листування навколо ОДНОГО конкретного розподілу (напр. "коли привезете?" / "привіз, чекайте на місці"). Не плутати з форумом алерту нижче — це приватніший канал між донором і отримувачем саме цієї поставки.
- **`AlertMessage`** (R12) — загальний форум під усім алертом, а не під одним розподілом: тут можуть писати всі залучені організації (і донори, і власник алерту) про алерт в цілому, видно з підсторінки `map/[alertId]`.

#### Як працює `ResourceAllocation` — пояснення потоку даних

`ResourceAllocation` — це один запис на **одну конкретну домовленість** "організація-донор передає організації-отримувачу N одиниць ресурсу X для алерту Y". Через цю модель проходять усі дані про сам обмін:

1. **Створення.** Донор бачить потребу (`AlertNeed`) на алерті й тисне "Przydziel zasoby" → створюється `ResourceAllocation` зі статусом `DELIVERY_AGREED`, `donorOrgId` = організація донора, `recipientOrgId` = `alert.organizationId` (власник алерту), `categoryId`/`itemName`/`quantity`/`unit` — знімок того, що саме приділяється (навіть якщо потім вихідний `Resource` зміниться чи видалиться, тут лишається як було на момент передачі). `need.quantityFulfilled` збільшується на `quantity`.
2. **Доставка.** Коли ресурс фізично довезено, статус переходить у `DELIVERED` — це може зробити донор (відзначив "відправив/довіз") або отримувач (відзначив "отримав"), дивись рішення #3.
3. **Використання.** Поки триває алерт, ресурс просто "висить" у статусі `DELIVERED` — саме це і показано в `resource.reservedQuantity` як зарезервоване.
4. **Повернення.** Коли отримувачу ресурс більше не потрібен (алерт завершується/скасовується), він переводить allocation у `RETURN_AGREED`, а потім через форму повернення створює один або кілька `AllocationReturnEvent` (крок 4 в переліку описів вище) — саме там зазначається скільки повернено, скільки не підлягає поверненню (R9), повідомлення (R4) і дата/час (R5).
5. **Підсумок.** Сума `quantityReturned`/`quantityNotReturnable` з усіх `AllocationReturnEvent` записується назад у `ResourceAllocation.quantityReturned`/`quantityNotReturnable`, і за формулою з розділу нижче виводиться фінальний статус — `PARTIALLY_RETURNED` або `RETURNED`. Тоді ж `resource.reservedQuantity` зменшується на **всю** щойно оброблену кількість (`quantityReturned + quantityNotReturnable` цього конкретного `AllocationReturnEvent`) — бронь знімається в обох випадках, ресурс перестає значитись "зайнятим". Але лише повернута частина (`quantityReturned`) фактично повертається у вільний обіг: **`resource.quantity` додатково й безповоротно зменшується на `quantityNotReturnable`** — те, що визнано неповоротним (використано/пошкоджено), фізично зникло в донора і не повинно знову зʼявлятися як "доступне" в Матриці. Тобто одна операція повернення чіпає два лічильники: `reservedQuantity` завжди звільняється повністю, а `quantity` зменшується лише на неповоротну частку.

Тобто `ResourceAllocation` — це міст між "хто що комусь дав" (донор/отримувач/кількість) і "в якому стані це зараз" (статус), а `AllocationReturnEvent` — деталізований журнал того, як саме це "закривалося" з часом.

```prisma
model AlertNeed {                    // "Zapotrzebowanie na zasoby"
  id                String   @id @default(cuid())
  alertId           String
  alert             Alert    @relation(fields: [alertId], references: [id], onDelete: Cascade)
  categoryId        String
  category          ResourceCategory @relation(fields: [categoryId], references: [id])
  title             String            // "Plandeki budowlane zbrojone (10x15)"
  description       String?
  quantityNeeded    Int
  quantityFulfilled Int      @default(0)   // денормалізовано, перерахунок у транзакції
  unit              String   @default("szt")
  urgency           NeedUrgency @default(NORMAL)
  status            NeedStatus  @default(OPEN)
  createdById       String?
  createdBy         User?    @relation(fields: [createdById], references: [id])
  allocations       ResourceAllocation[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([alertId])
}

model ResourceAllocation {
  id             String   @id @default(cuid())
  needId         String?
  need           AlertNeed? @relation(fields: [needId], references: [id], onDelete: SetNull)
  alertId        String
  alert          Alert    @relation(fields: [alertId], references: [id], onDelete: Cascade)
  resourceId     String?
  resource       Resource? @relation(fields: [resourceId], references: [id], onDelete: SetNull)
  categoryId     String            // знімок, переживає видалення ресурсу
  category       ResourceCategory @relation(fields: [categoryId], references: [id])
  itemName       String            // знімок resource.name
  quantity       Int
  quantityReturned      Int @default(0)
  quantityNotReturnable Int @default(0)
  unit           String   @default("szt")
  donorOrgId     String
  donorOrg       Organization @relation("Donor", fields: [donorOrgId], references: [id])
  recipientOrgId String?           // знімок alert.organizationId
  status         AllocationStatus @default(DELIVERY_AGREED)
  deliveredAt    DateTime?
  returnAgreedAt DateTime?
  createdById    String?
  createdBy      User?    @relation(fields: [createdById], references: [id])
  returnEvents   AllocationReturnEvent[]
  messages       AllocationMessage[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([alertId, status])
  @@index([donorOrgId, status])
}

model AllocationReturnEvent {          // журнал часткових повернень (R5, R9)
  id                    String   @id @default(cuid())
  allocationId          String
  allocation            ResourceAllocation @relation(fields: [allocationId], references: [id], onDelete: Cascade)
  quantityReturned      Int @default(0)
  quantityNotReturnable Int @default(0)
  notReturnableReason   String?
  message               String?         // R4
  returnedAt            DateTime        // поле в формі повернення, не now()
  recordedById          String?
  recordedBy            User?    @relation(fields: [recordedById], references: [id])
  createdAt DateTime @default(now())
  @@index([allocationId])
}

model AllocationMessage {              // вільне листування донор↔отримувач навколо одного allocation
  id           String   @id @default(cuid())
  allocationId String
  allocation   ResourceAllocation @relation(fields: [allocationId], references: [id], onDelete: Cascade)
  authorId     String?
  author       User?    @relation(fields: [authorId], references: [id])
  body         String
  createdAt DateTime @default(now())
  @@index([allocationId, createdAt])
}

// R12 — загальний форум під конкретним алертом (не прив'язаний до одного
// розподілу ресурсу, як AllocationMessage вище) — тред, де листуються всі
// організації, залучені до алерту: власник алерту + всі організації-донори,
// плюс ADMIN/COORDINATOR.
model AlertMessage {
  id        String   @id @default(cuid())
  alertId   String
  alert     Alert    @relation(fields: [alertId], references: [id], onDelete: Cascade)
  authorId  String?
  author    User?    @relation(fields: [authorId], references: [id])
  authorOrgId String?
  body      String
  createdAt DateTime @default(now())
  @@index([alertId, createdAt])
}
```

**Правило перерахунку статусу** (у `src/lib/allocations.ts`, виконується в транзакції після кожного `AllocationReturnEvent`):
```
totalReturned = sum(returnEvents.quantityReturned)
totalNotReturnable = sum(returnEvents.quantityNotReturnable)
if totalReturned + totalNotReturnable == 0: без змін (ще DELIVERED/RETURN_AGREED)
elif totalReturned + totalNotReturnable < quantity: status = PARTIALLY_RETURNED
else: status = RETURNED   // "все закрито" — і повернуте, і неповоротне разом дають повну кількість
```

**Правило оновлення лічильників на `Resource`** (та сама транзакція, при кожному новому `AllocationReturnEvent`, а не разово при фінальному статусі):
```
resource.reservedQuantity -= (event.quantityReturned + event.quantityNotReturnable)   // бронь знімається завжди
resource.quantity         -= event.quantityNotReturnable                              // фізично втрачене — назавжди
```
Тобто `quantityReturned` лише звільняє бронь (ресурс повертається в обіг у тій самій кількості), а `quantityNotReturnable` додатково й безповоротно зменшує загальний запас — щоб спожитий/пошкоджений ресурс не "воскресав" як доступний у Matryca Zasobów.

Розширити `AuditEntityType`/`AuditAction` (`src/lib/auditLog.ts`) додавши `RESOURCE`, `ALERT_NEED`, `RESOURCE_ALLOCATION` + відповідні `_CREATE/_UPDATE/_DELETE/_STATUS_CHANGE`.

---

## 3. API-роути (шаблон: zod-валідація + guard з `authz.ts` + `recordAudit` + типізовані try/catch, як у `src/app/api/admin/organizations/route.ts`)

| Роут | Методи | Призначення |
|---|---|---|
| `src/app/api/resources/route.ts` | GET, POST | GET: `scopedGminaWhere` + `?organizationId&categoryId&horizon`; POST: створює ресурс для організації користувача |
| `src/app/api/resources/[id]/route.ts` | GET, PATCH, DELETE | Guard: власна організація або ADMIN. 409 при DELETE якщо `reservedQuantity > 0` |
| `src/app/api/resources/matrix/route.ts` | GET | Агрегація `groupBy(categoryId, horizon)` для таблиці й плиток на R10 |
| `src/app/api/alerts/[id]/needs/route.ts` | GET, POST | POST: тільки власник-організація алерту або ADMIN |
| `src/app/api/needs/[id]/route.ts` | PATCH, DELETE | "Edytuj zapotrzebowanie"; 409 при DELETE якщо є активні розподіли |
| `src/app/api/alerts/[id]/allocations/route.ts` | GET, POST | POST = "Przydziel zasoby" (R11): будь-яка організація з відповідним ресурсом; транзакція: створити allocation, збільшити `resource.reservedQuantity`, перерахувати `need.quantityFulfilled/status` |
| `src/app/api/allocations/[id]/route.ts` | PATCH | Guard залежить від цільового статусу: `DELIVERY_AGREED`→`DELIVERED` може виконати **донор або отримувач** (хто перший підтвердить); `DELIVERED`→`RETURN_AGREED` виконує лише **отримувач** (`recipientOrgId`, тобто організація-власник алерту) — рішення #3 |
| `src/app/api/allocations/[id]/return-events/route.ts` | POST | Guard: тільки **отримувач**. Фіксація (часткового) повернення: `{ quantityReturned, quantityNotReturnable, notReturnableReason?, message?, returnedAt }` — це поля тієї ж форми повернення, не окреме вікно (R5); перераховує статус і звільняє `reservedQuantity`. `message` (R4) обов'язково потрапляє і в похідний inbox на `/zasoby` (розділ 5), не лише в історію розподілу |
| `src/app/api/allocations/[id]/messages/route.ts` | GET, POST | R4 — вільне листування навколо конкретного розподілу (донор/отримувач/ADMIN/COORDINATOR) |
| `src/app/api/alerts/[id]/messages/route.ts` | GET, POST | R12 — форум алерту (`AlertMessage`): будь-яка організація, залучена до алерту (власник + донори), плюс ADMIN/COORDINATOR |
| `src/app/api/alerts/[id]/cancel-with-return/route.ts` | POST | R8: тіло `{ returns: [{allocationId, quantityReturned, quantityNotReturnable, notReturnableReason?, message?, returnedAt}] }` — має покривати **кожен** нетермінальний розподіл цього алерту; одна `$transaction`: створює return-events, закриває alert.status='CANCELLED', закриває needs, `recordAudit` |
| `src/app/api/alerts/[id]/route.ts` (**правка**) | PATCH | Блокує прямий `status: CANCELLED`, якщо є нетермінальні розподіли → 409 з підказкою йти через `cancel-with-return` |
| `src/app/api/allocations/inbox/route.ts` | GET | R7 — похідний список "потребує дії" **для отримувача** (див. розділ 5) |

---

## 4. Авторизація (`src/lib/authz.ts`)

Зараз увесь код permission-checking — глобальний за роллю або gmina-scoped; жодного зв'язку з організацією немає. Потрібно додати:

- `organizationId` у сесію користувача (перевірити/розширити `src/types/next-auth.d.ts` і callbacks у `src/lib/auth.ts`).
- `isAlertOwnerOrg(alert, user)` → `!!user.organizationId && alert.organizationId === user.organizationId` — це і є "отримувач" з R2/R7.
- Оновити `canManageAlert()` в `AlertsMapView.tsx` (зараз: `alert.gminaId === currentUserGminaId`) → `ADMIN || isAlertOwnerOrg(...) || (COORDINATOR && alert.gminaId === user.gminaId)`.
- `isAllocationDonor(alloc, user)` — гейт кнопки "погоджено доставку" та створення нового allocation ("Przydziel zasoby"); разом з `isAllocationRecipient` також дає право позначити "доставлено".
- `isAllocationRecipient(alloc, user)` = `isAlertOwnerOrg(alloc.alert, user)` — гейт кнопки "доставлено" (спільно з донором), і одноосібно — "погоджено повернення", форми повернення (R2) і кнопки "Повернути ресурси" (R1).
- `page.tsx` наразі **не передає** `currentUserId`/`currentUserOrganizationId` у `AlertsMapView` — додати ці пропси.

**Жорстке обмеження доступу (пункт користувача #6 — безпека):** сторінка `/zasoby` і всі мутуючі роути ресурсів/розподілів (`/api/resources*`, `/api/alerts/[id]/needs*`, `/api/alerts/[id]/allocations*`, `/api/allocations/*`) використовують той самий guard, що й інші адміністративні розділи — `requireAdminOrCoordinator()` з `src/lib/authz.ts`. Роль `VOLUNTEER` не отримує доступу ні до сторінки, ні до жодного з цих API — ані на сервері (guard у кожному route.ts), ані в UI (пункт "Zasoby" в `Sidebar.tsx` не рендериться для `VOLUNTEER`, а сама сторінка `/zasoby` повертає 403/redirect на сервері незалежно від того, чи показано пункt меню — захист не покладається лише на приховування UI). Форум алерту (R12) — окремий, м'якший периметр: він успадковує видимість самого алерту (той самий `scopedGminaWhere`, що й на мапі), тобто доступний і волонтерам, які й так бачать цей алерт на мапі.

---

## 5. Сторінки та компоненти

### Нова сторінка `/zasoby` (R10, фото 1)
- `src/app/(protected)/zasoby/page.tsx` — server: сесія, `scopedGminaWhere`, агрегат матриці, список організацій, inbox-запит.
- `src/app/(protected)/zasoby/ResourceMatrixView.tsx` — client: плитки-статистика, чіпи категорій, дропдаун "Posiadacz", таблиця тип×горизонт (клікабельні клітинки), кнопки "Odśwież"/"+ Zgłoś nowe zasoby".
- `ResourceMatrixCellDrawer.tsx`, `ResourceFormModal.tsx` (модалка "Zgłoś Nowy Zasób do Matrycy", фото 6, кроки 1-4 з R10 вище — POST на `src/app/api/resources/route.ts`).
- **Похідні сповіщення (R7)** замість окремої моделі `Notification` (у системі взагалі немає notification-інфраструктури — жодних job/queue/email-on-event, окрім email при invite): панель "Wymaga działania" на початку `/zasoby` + бейдж у Sidebar, побудовані на запиті. Це **отримувач** (organizacja-власник алерту), тому фільтр — по `alert.organizationId`, не по `donorOrgId`:
  ```ts
  prisma.resourceAllocation.findMany({
    where: {
      alert: { organizationId: user.organizationId, status: { in: ['CANCELLED', 'RESOLVED'] } },
      status: { notIn: ['RETURNED', 'CANCELLED'] },
    },
    include: { returnEvents: true, alert: true }, // returnEvents.message (R4) теж показуємо тут
  })
  ```
  Кожен рядок — кнопка "Zwróć zasoby", що відкриває форму повернення (див. `ReturnResourcesModal` нижче) для цього конкретного розподілу. Донори бачать окрему, лише інформаційну секцію ("Twoje zasoby w trakcie" / "Alert odwołany — oczekuje na zwrot") без кнопок дії — статус змінює тільки отримувач.

### Правки існуючих файлів мапи (R1, R6, R11)
- `map/page.tsx` — додати `organizationId: true` у select алерту, `needs: { include: { allocations: true } }`; передати `currentUserId`, `currentUserOrganizationId`.
- `map/AlertsMapView.tsx` — новий блок `<AlertNeedsBlock>` між описом і рядком кнопок (активні картки ~785-901, архівні ~1046-1142); бейдж "Masz zasoby (N)" у заголовку картки; замінити inline `canManageAlert` на хелпер з `authz.ts`.
- `map/AlertActions.tsx` — нові пропси `isOwnerOrg`, `openAllocationCount`; кнопка "Повернути ресурси" (R1) видима лише при `isOwnerOrg`; при спробі скасувати алерт з `openAllocationCount > 0` — відкрити `CancelWithReturnModal` (R8) замість прямого PATCH.
- Нові: `map/AlertNeedsBlock.tsx`, `components/resources/AllocateResourcesModal.tsx`, `NeedFormModal.tsx`, `ReturnResourcesModal.tsx` (одна форма: ресурс / кількість повернено / кількість не підлягає поверненню + причина / повідомлення / дата-час повернення — усе разом, без окремого вікна, R4+R5+R9), `AllocationContributorsList.tsx`, `AllocationStatusBadge.tsx`.
- `src/lib/alertLabels.ts` — за зразком додати `src/lib/resourceLabels.ts` (`ALLOCATION_STATUS_LABELS`, `NEED_URGENCY_LABELS`, `HORIZON_LABELS`, кожен `{label, badgeClass, dotClass}`).
- `src/components/layout/Sidebar.tsx` — пункт "Zasoby" + бейдж inbox-кількості (не рендерити для `VOLUNTEER`).

### Нова підсторінка алерту + форум (R12, фото 3/4/5)
- Кнопка "Forum" додається в `AlertNeedsBlock.tsx` (фото 3 — кнопка поряд із потребами на картці), веде на `src/app/(protected)/map/[alertId]/page.tsx`.
- `map/[alertId]/page.tsx` — server component: повна інформація про алерт (фото 4: заголовок, опис, категорія/терміновість, локація, статус, список потреб і хто скільки приділив) + сам тред форуму під нею (фото 5).
- `map/[alertId]/AlertForumThread.tsx` — client component: список `AlertMessage` (найстаріші → найновіші) + форма нового повідомлення; POST на `src/app/api/alerts/[id]/messages/route.ts`.
- Видимість сторінки/форуму = видимість самого алерту (`scopedGminaWhere`, той самий, що на мапі) — тобто доступна й `VOLUNTEER`, на відміну від `/zasoby` (див. розділ 4, "Жорстке обмеження доступу").

---

## 6. Фазування

1. **Схема + базовий API ресурсів** — `schema.prisma` (3 міграції: додати поля nullable → backfill → зробити required), `authz.ts`, `resourceLabels.ts`, `/api/resources*`.
2. **Needs + Allocations API** — `/api/alerts/[id]/needs`, `/api/needs/[id]`, `/api/alerts/[id]/allocations`, `/api/allocations/[id]`, `/return-events`, `/messages`.
3. **Сторінка Matryca Zasobów** — `/zasoby` + матрична агрегація + форми.
4. **Інтеграція в Map** — пропси `page.tsx`, `AlertNeedsBlock`, бейдж "Masz zasoby", кнопки "Przydziel"/"Edytuj zapotrzebowanie".
5. **Повернення + скасування** — `ReturnResourcesModal`, `cancel-with-return`, правка `AlertActions`, 409-гейт у `api/alerts/[id]`.
6. **Похідні сповіщення** — inbox-запит (по `alert.organizationId`, розділ 5), панель, бейдж у Sidebar.
7. **Форум алерту (R12)** — модель `AlertMessage`, `api/alerts/[id]/messages`, сторінка `map/[alertId]/page.tsx` + `AlertForumThread.tsx`, кнопка "Forum" у `AlertNeedsBlock.tsx`.

---

## 7. Що ви, можливо, упустили в чернетці

1. **Хто створює "потребу" (Need/zapotrzebowanie) на алерті** — чернетка каже про кнопку повернення й підтвердження розподілу, але не описує сам процес заявлення потреби (категорія, кількість, терміновість) — саме це на фото 2 виглядає як "Edytuj zapotrzebowanie". Додано як окрема модель `AlertNeed`.
2. **Хто бачить кнопку "Przydziel zasoby"** — будь-яка організація з відповідним ресурсом, чи лише "перевірені"/"lead" організації? У плані — будь-яка організація з активним ресурсом відповідної категорії.
3. ~~**Роль VOLUNTEER**~~ — **вирішено**: волонтер не має доступу до розділу ресурсів взагалі (ні сторінка, ні API). Приділяти/повертати ресурси від імені організації можуть лише `ADMIN`/`COORDINATOR` цієї організації (розділ 4). Форум алерту (R12) — виняток, туди волонтер доступ має, бо це частина видимості самого алерту на мапі.
4. **Крос-гмінна видимість** — поточний `scopedGminaWhere` fail-closed: організація з гміни A не побачить алерт гміни B. Якщо допомога має надаватися між гмінами (а це логічно для кризових ситуацій), фільтр потрібно послабити саме для розділу ресурсів/розподілів.
5. **Скасування алертом-адміном (не власником)** — ваша чернетка описує лише кейс, коли скасовує власник (R8). Якщо адмін скасовує алерт іншої організації, чи адмін теж повинен заповнити таблицю повернення, чи це лишається на донорах через inbox (R7)? У плані — друге (простіше).
6. **Видалення/редагування вже розподіленого ресурсу** — що робити з розподілами, якщо донор видаляє чи редагує `Resource` (наприклад, зменшує кількість нижче вже зарезервованої)? Потрібні бізнес-правила (409 при конфлікті).
7. **Ліміт/валідація кількості при поверненні** — `quantityReturned + quantityNotReturnable` не повинні перевищувати `quantity` розподілу; це в плані закладено, але вимагає явної валідації в API, якої немає в чернетці.
8. **Видимість повідомлень (AllocationMessage)** — чи вони приватні між донором/отримувачем, чи бачить адмін/координатор? У плані — донор, отримувач, ADMIN.
9. **Дублікати пропозицій** — клієнт у зустрічі 2 явно просив попереджати, якщо на одну потребу вже є пропозиція в процесі (щоб уникнути надлишкового приділення) — цього немає в чернетці, але варто додати попередження в UI "Przydziel zasoby", коли `quantityFulfilled` вже покриває потребу.
10. **Історія/аудит для звітності гміні/донору** — чи потрібен експорт/звіт "хто кому що передав і повернув" за період (згадувалось на зустрічах як цінність для звітності перед бурмістром)? Не в MVP цього плану, але легко додається пізніше через `AuditLog` + `AllocationReturnEvent`.

---

## 8. Перевірка

- Юніт-тести для `src/lib/allocations.ts` (перерахунок статусу з часткових повернень) та `src/lib/authz.ts` (нові хелпери — окремо для донора й отримувача), за зразком існуючих `*.test.ts`.
- **Безпека/захист маршрутів (пункт користувача #6):** окремий тест-прохід під `VOLUNTEER` — переконатися, що `/zasoby` віддає 403/redirect на сервері (не лише приховує пункт меню), і що жоден з `/api/resources*`, `/api/alerts/[id]/needs*`, `/api/alerts/[id]/allocations*`, `/api/allocations/*` не виконується для `VOLUNTEER` навіть при прямому запиті. Окремо перевірити, що донор не може виконати дії отримувача (`DELIVERED`→`RETURN_AGREED`, return-events) і навпаки — кожен guard у `authz.ts` покриває саме свою сторону.
- Ручна перевірка через `npm run dev`: створити алерт від організації A → додати Need → організація B (донор) приділяє ресурс, статус `DELIVERY_AGREED` → організація A підтверджує "доставлено" (`DELIVERED`) → організація A скасовує алерт → з'являється `CancelWithReturnModal`, без заповнення форми скасування блокується (409) → після заповнення — алерт CANCELLED, у організації A (отримувача) в inbox `/zasoby` з'являється запис із кнопкою "Zwróć zasoby" (якщо не все закрито в момент скасування) → відкрити форму повернення, зазначити часткове повернення (3 з 5, 2 не підлягають поверненню) з повідомленням і датою/часом → перевірити статус `PARTIALLY_RETURNED`/`RETURNED` і що повідомлення видно на `/zasoby`.
- Перевірити форум (R12): з картки алерту з потребами відкрити "Forum" → перейти на `map/[alertId]` → побачити повну інфу про алерт і тред → написати повідомлення від імені організації-донора і від імені організації-власника → перевірити, що волонтер без ролі ADMIN/COORDINATOR теж бачить і може писати у форум (на відміну від `/zasoby`).
- `npx prisma migrate dev` + `npx prisma studio` для візуальної перевірки нових таблиць/зв'язків.
