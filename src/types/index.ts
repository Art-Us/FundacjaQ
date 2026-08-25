export type Role = 'ADMIN' | 'NGO' | 'FIREFIGHTER' | 'COORDINATOR' | 'VOLUNTEER';

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type AlertStatus = 'ACTIVE' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED';

export type ResourceStatus = 'AVAILABLE' | 'RESERVED' | 'IN_USE' | 'DEPLETED';

export interface GminaData {
    id: string;
    name: string;
    powiat: string;
    voivodeship: string;
    contactEmail?: string | null;
    contactPhone?: string | null;
}

export interface AlertData {
    id: string;
    title: string;
    description: string;
    severity: Severity;
    status: AlertStatus;
    location?: string | null;
    gminaId: string;
    gmina?: GminaData;
    createdAt: Date | string;
    updatedAt: Date | string;
}

export interface ResourceData {
    id: string;
    name: string;
    description?: string | null;
    quantity: number;
    unit: string;
    status: ResourceStatus;
    location?: string | null;
    categoryId: string;
    gminaId: string;
    gmina?: GminaData;
}
