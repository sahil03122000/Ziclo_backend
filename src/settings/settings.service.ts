import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSettingDto } from './dto/create-setting.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';

// SystemSetting type alias until prisma generate resolves the DLL lock
type SystemSetting = { id: string; key: string; value: string; description: string | null; updatedAt: Date };

@Injectable()
export class SettingsService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get db(): any { return this.prisma; }

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSettingDto) {
    const existing = await this.db.systemSetting.findUnique({ where: { key: dto.key } });
    if (existing) throw new ConflictException(`Setting with key '${dto.key}' already exists`);

    const setting: SystemSetting = await this.db.systemSetting.create({ data: dto });
    return { success: true, message: 'Setting created successfully', data: setting };
  }

  async findAll() {
    const settings: SystemSetting[] = await this.db.systemSetting.findMany({
      orderBy: { key: 'asc' },
    });
    return { success: true, data: settings };
  }

  async findByKey(key: string) {
    const setting: SystemSetting | null = await this.db.systemSetting.findUnique({ where: { key } });
    if (!setting) throw new NotFoundException(`Setting '${key}' not found`);
    return { success: true, data: setting };
  }

  async update(id: string, dto: UpdateSettingDto) {
    const existing: SystemSetting | null = await this.db.systemSetting.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Setting not found');

    const setting: SystemSetting = await this.db.systemSetting.update({
      where: { id },
      data: dto,
    });
    return { success: true, message: 'Setting updated successfully', data: setting };
  }

  async upsert(key: string, value: string, description?: string) {
    const setting: SystemSetting = await this.db.systemSetting.upsert({
      where: { key },
      create: { key, value, description },
      update: { value },
    });
    return { success: true, data: setting };
  }
}
