import { User, CadFeature, Feature, cad, Prisma } from "@prisma/client";
import { WEAPON_SCHEMA } from "@snailycad/schemas";
import { UseBeforeEach, Context, BodyParams, PathParams, QueryParams } from "@tsed/common";
import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { Post, Delete, Put, Description, Get } from "@tsed/schema";
import { canManageInvariant } from "lib/auth/getSessionUser";
import { isFeatureEnabled } from "lib/cad";
import { shouldCheckCitizenUserId } from "lib/citizen/hasCitizenAccess";
import { prisma } from "lib/prisma";
import { validateSchema } from "lib/validateSchema";
import { IsAuth } from "middlewares/IsAuth";
import { generateString } from "utils/generateString";
import { citizenInclude } from "./CitizenController";
import type * as APITypes from "@snailycad/types/api";
import { ExtendedBadRequest } from "src/exceptions/ExtendedBadRequest";
import type { Weapon } from "@snailycad/types";

@Controller("/weapons")
@UseBeforeEach(IsAuth)
export class WeaponController {
  private MAX_ITEMS_PER_TABLE_PAGE = 12;
  private SERIAL_NUMBER_LENGTH = 10;

  @Get("/:citizenId")
  async getCitizenWeapons(
    @PathParams("citizenId") citizenId: string,
    @Context("user") user: User,
    @Context("cad") cad: cad,
    @QueryParams("skip", Number) skip = 0,
    @QueryParams("query", String) query?: string,
  ): Promise<APITypes.GetCitizenWeaponsData> {
    const checkCitizenUserId = shouldCheckCitizenUserId({ cad, user });
    const citizen = await prisma.citizen.findFirst({
      where: { id: citizenId, userId: checkCitizenUserId ? user.id : undefined },
    });

    if (!citizen) {
      throw new NotFound("citizenNotFound");
    }

    const where: Prisma.WeaponWhereInput = {
      ...{ citizenId },
      ...(query
        ? {
            OR: [
              { model: { value: { value: { contains: query, mode: "insensitive" } } } },
              { registrationStatus: { value: { contains: query, mode: "insensitive" } } },
              { serialNumber: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [totalCount, weapons] = await Promise.all([
      prisma.weapon.count({ where }),
      prisma.weapon.findMany({
        where,
        take: this.MAX_ITEMS_PER_TABLE_PAGE,
        skip,
        include: citizenInclude.weapons.include,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return { totalCount, weapons };
  }

  @Post("/")
  @Description("Register a new weapon")
  async registerWeapon(
    @Context("user") user: User,
    @Context("cad") cad: cad & { features?: CadFeature[] },
    @BodyParams() body: unknown,
  ): Promise<APITypes.PostCitizenWeaponData> {
    const data = validateSchema(WEAPON_SCHEMA, body);

    const citizen = await prisma.citizen.findUnique({
      where: {
        id: data.citizenId,
      },
    });

    const checkCitizenUserId = shouldCheckCitizenUserId({ cad, user });
    if (checkCitizenUserId) {
      canManageInvariant(citizen?.userId, user, new NotFound("notFound"));
    } else if (!citizen) {
      throw new NotFound("NotFound");
    }

    const isCustomEnabled = isFeatureEnabled({
      features: cad.features,
      feature: Feature.CUSTOM_TEXTFIELD_VALUES,
      defaultReturn: false,
    });

    let modelId = data.model;

    if (isCustomEnabled) {
      const newModel = await prisma.weaponValue.create({
        data: {
          value: {
            create: {
              isDefault: false,
              type: "WEAPON",
              value: data.model,
            },
          },
        },
      });

      modelId = newModel.id;
    }

    const weaponModel = await prisma.weaponValue.findUnique({
      where: { id: modelId },
    });

    if (!weaponModel) {
      throw new ExtendedBadRequest({
        model: "Invalid weapon model. Please re-enter the weapon model.",
      });
    }

    const weapon = await prisma.weapon.create({
      data: {
        citizenId: citizen.id,
        registrationStatusId: data.registrationStatus as string,
        serialNumber: await this.generateOrValidateSerialNumber(data.serialNumber || null),
        userId: user.id || undefined,
        modelId,
      },
      include: citizenInclude.weapons.include,
    });

    return weapon;
  }

  @Put("/:id")
  @Description("Update a registered weapon")
  async updateWeapon(
    @Context("user") user: User,
    @Context("cad") cad: cad & { features?: CadFeature[] },
    @PathParams("id") weaponId: string,
    @BodyParams() body: unknown,
  ): Promise<APITypes.PutCitizenWeaponData> {
    const data = validateSchema(WEAPON_SCHEMA, body);

    const weapon = await prisma.weapon.findUnique({
      where: {
        id: weaponId,
      },
    });

    const checkCitizenUserId = shouldCheckCitizenUserId({ cad, user });
    if (checkCitizenUserId) {
      canManageInvariant(weapon?.userId, user, new NotFound("notFound"));
    } else if (!weapon) {
      throw new NotFound("NotFound");
    }

    const isCustomEnabled = isFeatureEnabled({
      features: cad.features,
      feature: Feature.CUSTOM_TEXTFIELD_VALUES,
      defaultReturn: false,
    });

    let modelId = data.model;

    if (isCustomEnabled) {
      const weaponModel = await prisma.weaponValue.findFirst({
        where: { value: { value: { equals: data.model, mode: "insensitive" } } },
      });

      const newModel = await prisma.weaponValue.upsert({
        where: { id: String(weaponModel?.id) },
        update: {},
        create: {
          value: {
            create: {
              isDefault: false,
              type: "WEAPON",
              value: data.model,
            },
          },
        },
      });

      modelId = newModel.id;
    }

    const updated = await prisma.weapon.update({
      where: {
        id: weapon.id,
      },
      data: {
        modelId,
        registrationStatusId: data.registrationStatus as string,
        serialNumber: data.serialNumber
          ? await this.generateOrValidateSerialNumber(data.serialNumber, weapon)
          : undefined,
      },
      include: citizenInclude.weapons.include,
    });

    return updated;
  }

  @Delete("/:id")
  @Description("Delete a registered weapon")
  async deleteWeapon(
    @Context("user") user: User,
    @Context("cad") cad: cad,
    @PathParams("id") weaponId: string,
  ): Promise<APITypes.DeleteCitizenWeaponData> {
    const weapon = await prisma.weapon.findUnique({
      where: {
        id: weaponId,
      },
    });

    const checkCitizenUserId = shouldCheckCitizenUserId({ cad, user });
    if (checkCitizenUserId) {
      canManageInvariant(weapon?.userId, user, new NotFound("notFound"));
    } else if (!weapon) {
      throw new NotFound("NotFound");
    }

    await prisma.weapon.delete({
      where: {
        id: weapon.id,
      },
    });

    return true;
  }

  private async generateOrValidateSerialNumber(
    _serialNumber?: string | null,
    weapon?: Pick<Weapon, "id">,
  ): Promise<string> {
    const serialNumber = _serialNumber ?? generateString(this.SERIAL_NUMBER_LENGTH);

    const existing = await prisma.weapon.findFirst({
      where: {
        serialNumber: { mode: "insensitive", equals: serialNumber },
        NOT: weapon ? { id: weapon.id } : undefined,
      },
    });

    if (!existing) {
      return serialNumber;
    }

    if (_serialNumber) {
      throw new ExtendedBadRequest({ serialNumber: "serialNumberInUse" });
    }

    return this.generateOrValidateSerialNumber(_serialNumber, weapon);
  }
}
