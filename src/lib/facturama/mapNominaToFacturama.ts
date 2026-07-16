export type NominaPercepcionInput = {
  tipoPercepcion: string;
  clave: string;
  concepto: string;
  importeGravado: number;
  importeExento: number;
};

export type NominaDeduccionInput = {
  tipoDeduccion: string;
  clave: string;
  concepto: string;
  importe: number;
};

export type NominaOtroPagoInput = {
  tipoOtroPago: string;
  clave: string;
  concepto: string;
  importe: number;
  /** Subsidio causado (requerido para TipoOtroPago 002). */
  subsidioCausado?: number;
};

export type NominaEmployeeInput = {
  rfc: string;
  nombre: string;
  curp: string;
  nss?: string;
  numeroEmpleado: string;
  tipoContrato: string;
  tipoJornada?: string;
  tipoRegimen: string;
  puesto: string;
  riesgoPuesto?: string;
  periodicidadPago: string;
  banco?: string;
  cuentaBancaria?: string;
  fechaInicioRelLaboral: string;
  departamento?: string;
  /** Clave entidad federativa (c_Estado), ej. JAL */
  claveEntFed: string;
  codigoPostal: string;
  regimenFiscalReceptor?: string;
  salarioBaseCotApor?: number;
  salarioDiarioIntegrado?: number;
};

export type NominaPayloadInput = {
  expeditionPlace: string;
  serie?: string;
  folio?: string;
  paymentForm?: string;
  tipoNomina: 'O' | 'E';
  fechaPago: string;
  fechaInicialPago: string;
  fechaFinalPago: string;
  numDiasPagados: number;
  employee: NominaEmployeeInput;
  perceptions: NominaPercepcionInput[];
  deductions?: NominaDeduccionInput[];
  otherPayments?: NominaOtroPagoInput[];
};

function money2(n: number): string {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
}

/**
 * CFDI Nómina 1.2 (CfdiType N) para Facturama API Web.
 */
export function mapNominaToFacturama(input: NominaPayloadInput): Record<string, unknown> {
  const emp = input.employee;
  if (!emp.rfc?.trim() || !emp.curp?.trim() || !emp.nombre?.trim()) {
    throw new Error('Empleado incompleto (RFC, CURP, nombre)');
  }
  if (!input.perceptions.length) {
    throw new Error('Debe haber al menos una percepción');
  }

  let totalGravado = 0;
  let totalExento = 0;
  const percDetails = input.perceptions.map((p) => {
    const g = Number(p.importeGravado) || 0;
    const e = Number(p.importeExento) || 0;
    totalGravado += g;
    totalExento += e;
    return {
      PerceptionType: p.tipoPercepcion,
      Code: p.clave,
      Description: p.concepto,
      TaxedAmount: money2(g),
      ExemptAmount: money2(e),
    };
  });

  let totalOtherDeductions = 0;
  let totalTaxesWithheld = 0;
  const dedDetails = (input.deductions ?? []).map((d) => {
    const imp = Number(d.importe) || 0;
    if (d.tipoDeduccion === '002') totalTaxesWithheld += imp;
    else totalOtherDeductions += imp;
    return {
      DeductionType: d.tipoDeduccion,
      Code: d.clave,
      Description: d.concepto,
      Amount: money2(imp),
    };
  });

  const otherDetails = (input.otherPayments ?? []).map((o) => {
    const row: Record<string, unknown> = {
      OtherPaymentType: o.tipoOtroPago,
      Code: o.clave,
      Description: o.concepto,
      Amount: money2(o.importe),
    };
    if (o.tipoOtroPago === '002') {
      row.SubsidyPaid = {
        Amount: money2(o.subsidioCausado ?? o.importe),
      };
    }
    return row;
  });

  const employeeNode: Record<string, unknown> = {
    Curp: emp.curp.trim().toUpperCase(),
    EmployeeNumber: emp.numeroEmpleado,
    ContractType: emp.tipoContrato,
    RegimeType: emp.tipoRegimen,
    Position: emp.puesto,
    FrequencyPayment: emp.periodicidadPago,
    StartDateLaborRelations: emp.fechaInicioRelLaboral,
    FederalEntityKey: emp.claveEntFed,
  };
  if (emp.nss?.trim()) employeeNode.SocialSecurityNumber = emp.nss.trim();
  if (emp.tipoJornada?.trim()) employeeNode.WorkingDayType = emp.tipoJornada.trim();
  if (emp.riesgoPuesto?.trim()) employeeNode.RiskWorkPlace = emp.riesgoPuesto.trim();
  if (emp.departamento?.trim()) employeeNode.Department = emp.departamento.trim();
  if (emp.banco?.trim()) employeeNode.Bank = emp.banco.trim();
  if (emp.cuentaBancaria?.trim()) employeeNode.BankAccount = emp.cuentaBancaria.trim();
  if (emp.salarioBaseCotApor != null) {
    employeeNode.BaseSalary = money2(emp.salarioBaseCotApor);
  }
  if (emp.salarioDiarioIntegrado != null) {
    employeeNode.DailySalary = money2(emp.salarioDiarioIntegrado);
  }

  const payroll: Record<string, unknown> = {
    Type: input.tipoNomina,
    PaymentDate: input.fechaPago,
    InitialPaymentDate: input.fechaInicialPago,
    FinalPaymentDate: input.fechaFinalPago,
    DaysPaid: String(input.numDiasPagados),
    Employee: employeeNode,
    Perceptions: {
      Details: percDetails,
      TotalTaxed: money2(totalGravado),
      TotalExempt: money2(totalExento),
      TotalSalary: money2(totalGravado + totalExento),
    },
  };

  if (dedDetails.length) {
    payroll.Deductions = {
      Details: dedDetails,
      TotalOtherDeductions: money2(totalOtherDeductions),
      TotalTaxesWithheld: money2(totalTaxesWithheld),
    };
  }
  if (otherDetails.length) {
    payroll.OtherPayments = { Details: otherDetails };
  }

  return {
    NameId: '1',
    CfdiType: 'N',
    ExpeditionPlace: String(input.expeditionPlace).trim(),
    Serie: input.serie || undefined,
    Folio: input.folio ? String(input.folio) : undefined,
    PaymentForm: input.paymentForm || '99',
    Exportation: '01',
    Receiver: {
      Rfc: emp.rfc.trim().toUpperCase(),
      Name: emp.nombre.trim().toUpperCase(),
      CfdiUse: 'CN01',
      FiscalRegime: emp.regimenFiscalReceptor || '605',
      TaxZipCode: emp.codigoPostal.trim(),
    },
    Complemento: {
      Payroll: payroll,
    },
  };
}
