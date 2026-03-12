import { z } from "zod";
import { toolResult } from "@hmls/shared/tool-result";

const lookupObdCodeSchema = z.object({
  code: z.string().describe("OBD-II code to look up (e.g., P0301)"),
});

// Common OBD-II code reference
const OBD_CODES: Record<string, { description: string; system: string }> = {
  // Misfire codes
  P0300: {
    description: "Random/Multiple Cylinder Misfire Detected",
    system: "Ignition",
  },
  P0301: { description: "Cylinder 1 Misfire Detected", system: "Ignition" },
  P0302: { description: "Cylinder 2 Misfire Detected", system: "Ignition" },
  P0303: { description: "Cylinder 3 Misfire Detected", system: "Ignition" },
  P0304: { description: "Cylinder 4 Misfire Detected", system: "Ignition" },
  P0305: { description: "Cylinder 5 Misfire Detected", system: "Ignition" },
  P0306: { description: "Cylinder 6 Misfire Detected", system: "Ignition" },
  P0307: { description: "Cylinder 7 Misfire Detected", system: "Ignition" },
  P0308: { description: "Cylinder 8 Misfire Detected", system: "Ignition" },

  // Fuel system
  P0171: { description: "System Too Lean (Bank 1)", system: "Fuel" },
  P0172: { description: "System Too Rich (Bank 1)", system: "Fuel" },
  P0174: { description: "System Too Lean (Bank 2)", system: "Fuel" },
  P0175: { description: "System Too Rich (Bank 2)", system: "Fuel" },

  // Emissions
  P0420: {
    description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    system: "Emissions",
  },
  P0430: {
    description: "Catalyst System Efficiency Below Threshold (Bank 2)",
    system: "Emissions",
  },
  P0440: {
    description: "Evaporative Emission Control System Malfunction",
    system: "EVAP",
  },
  P0442: {
    description: "Evaporative Emission Control System Leak Detected (small leak)",
    system: "EVAP",
  },
  P0455: {
    description: "Evaporative Emission Control System Leak Detected (gross leak)",
    system: "EVAP",
  },
  P0456: {
    description: "Evaporative Emission Control System Leak Detected (very small leak)",
    system: "EVAP",
  },

  // Engine
  P0011: {
    description: "Intake Camshaft Position Timing Over-Advanced (Bank 1)",
    system: "Timing",
  },
  P0012: {
    description: "Intake Camshaft Position Timing Over-Retarded (Bank 1)",
    system: "Timing",
  },
  P0128: {
    description: "Coolant Thermostat Below Regulating Temperature",
    system: "Cooling",
  },

  // Transmission
  P0700: {
    description: "Transmission Control System Malfunction",
    system: "Transmission",
  },
  P0715: {
    description: "Input/Turbine Speed Sensor Circuit Malfunction",
    system: "Transmission",
  },

  // Sensors
  P0101: {
    description: "Mass Air Flow Circuit Range/Performance Problem",
    system: "Sensors",
  },
  P0102: { description: "Mass Air Flow Circuit Low Input", system: "Sensors" },
  P0103: { description: "Mass Air Flow Circuit High Input", system: "Sensors" },
  P0113: {
    description: "Intake Air Temperature Circuit High Input",
    system: "Sensors",
  },
  P0117: {
    description: "Engine Coolant Temperature Circuit Low Input",
    system: "Sensors",
  },
  P0118: {
    description: "Engine Coolant Temperature Circuit High Input",
    system: "Sensors",
  },
  P0131: {
    description: "O2 Sensor Circuit Low Voltage (Bank 1 Sensor 1)",
    system: "Sensors",
  },
  P0134: {
    description: "O2 Sensor Circuit No Activity Detected (Bank 1 Sensor 1)",
    system: "Sensors",
  },
  P0500: { description: "Vehicle Speed Sensor Malfunction", system: "Sensors" },
};

export const lookupObdCodeTool = {
  name: "lookupObdCode",
  description: "Look up OBD-II diagnostic trouble code description and system",
  schema: lookupObdCodeSchema,
  // deno-lint-ignore require-await
  execute: async (params: z.infer<typeof lookupObdCodeSchema>) => {
    const { code } = params;
    const upperCode = code.toUpperCase().trim();

    const info = OBD_CODES[upperCode];

    if (info) {
      return toolResult({
        code: upperCode,
        description: info.description,
        system: info.system,
        found: true,
      });
    }

    // Parse code structure for unknown codes
    const codeType = upperCode[0];
    const typeMap: Record<string, string> = {
      P: "Powertrain",
      B: "Body",
      C: "Chassis",
      U: "Network",
    };

    return toolResult({
      code: upperCode,
      description: "Code not in reference database",
      system: typeMap[codeType] || "Unknown",
      found: false,
      note:
        "Manufacturer-specific code or not in common database. Agent will interpret based on context.",
    });
  },
};
