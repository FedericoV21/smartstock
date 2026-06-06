<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## SmartStock backend bootstrap

Despliegue objetivo: **PostgreSQL** (instancia gestionada o VM) + **Nest** como API, con **Next** como frontend aparte. El backend habla solo SQL/TLS con Postgres y valida JWT con **`JWT_SECRET`** (HS256; alias legacy `SUPABASE_JWT_SECRET`) alineado con el emisor de tokens del login; no asume un proveedor concreto de base de datos ni de hosting.

### 1) Configurar entorno

```bash
cp .env.example .env.local
```

### 2) Build del proyecto

```bash
npm run build
```

### 3) Flujo de migraciones (estándar equipo)

Primera vez en **Postgres vacío** (mudanza Nest + Postgres, sin esquema Supabase previo):

```bash
npm run build
npm run migration:run
```

La migración `1742000000000-nb-baseline-core-schema` crea tablas núcleo; las siguientes agregan barcodes, idempotencia y grants del worker ARCA. Detalle: `docs/migracion-nest-postgres.md`.

Cambios incrementales posteriores:

```bash
npm run migration:generate
npm run build
npm run migration:run
```

> `migration:generate` crea por defecto `src/database/migrations/auto-migration.ts`.

### CI (GitHub Actions)

Workflow `.github/workflows/backend-ci.yml` en la ra├¡z del monorepo:

1. Postgres 16 (service container)
2. `npm run build -w @smartstock/backend`
3. `npm run migration:run -w @smartstock/backend`
4. `npm run test -w @smartstock/backend` (209+ tests unitarios)
5. `npm run test:e2e -w @smartstock/backend` (smoke `GET /api/v1/health`)

Se dispara en push/PR que toquen `apps/backend/**` o el propio workflow.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

### Probar en local

1. `npm run build` (debe generar `dist/main.js`; si fallara sin errores, borr├í `tsconfig.tsbuildinfo` si existe y recompil├í).
2. `npm run start:dev` ÔÇö API en `http://localhost:4000` (o el `PORT` del `.env`).
3. **Health** (sin token): `GET http://localhost:4000/api/v1/health`
4. **Swagger** (no producci├│n): `http://localhost:4000/api/docs` ÔÇö prob├í endpoints con **Authorize** y un JWT HS256 que incluya `tenant_id` y rol seg├║n tus guards.

### CORS (Next u otro front)

Por defecto se permite `http://localhost:3000`. Para m├ís or├¡genes o producci├│n:

```env
NEST_CORS_ORIGINS=https://app.tudominio.com,http://localhost:3000
```

Sin variable en `.env`, el default es `http://localhost:3000`. Si defin├¡s `NEST_CORS_ORIGINS` como cadena vac├¡a, no se llama a `enableCors` (├║til si solo hay llamadas servidor-a-servidor).

## Run tests

```bash
# unit tests
$ npm run test

# e2e (requiere Postgres accesible con las variables DB_* del entorno; ver test/jest-e2e-setup.js)
# Antes: compilar para que TypeORM cargue entidades desde dist/
$ npm run build
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
