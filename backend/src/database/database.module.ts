import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { identityEntities } from "./data-source.js";

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: "postgres",
      url: process.env.DATABASE_URL,
      entities: identityEntities,
      synchronize: false,
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
