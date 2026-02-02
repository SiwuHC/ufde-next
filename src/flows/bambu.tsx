import {
  ActionIcon,
  Combobox,
  Group,
  Input,
  InputBase,
  NumberInput,
  SegmentedControl,
  Text,
  Tooltip,
  useCombobox,
} from "@mantine/core";
import { TbArrowAutofitDown, TbChevronDown } from "react-icons/tb";
import {
  showFailedNotification,
  showSuccessNotification,
} from "../pages/Notifies";
import { invoke } from "@tauri-apps/api/core";
import React, { useContext } from "react";
import { getDirOfFile } from "../utils/utils";
import { ProjectContext } from "../App";
import { Command } from "@tauri-apps/plugin-shell";
import { resolveResource } from "@tauri-apps/api/path";
import { useTranslation } from "react-i18next";
import { ProjectInfo } from "../model/project";
import { writeTextFile, exists, readTextFile } from "@tauri-apps/plugin-fs";
import { devicePorts } from "../utils/Pins";

// Local SettingsItem component to avoid circular dependency
function SettingsItem({
  label,
  component,
}: {
  label: string;
  component: React.ReactNode;
}) {
  return (
    <Group justify="space-between">
      <Text size="md">{label}</Text>
      {component}
    </Group>
  );
}


// HLS Settings Page Component
export function BambuHLSSettingsPage() {
  const { t } = useTranslation();
  const projectContext = useContext(ProjectContext);
  const { project, setProject, setProjectModified } = projectContext;

  return (
    <>
      <SettingsItem
        label={t("flow.bambu.hls.top_function")}
        component={
          <Input
            placeholder="main"
            defaultValue={project?.settings.bambu?.topFunction || "main"}
            onChange={(e) => {
              var newProject = project!;
              if (!newProject.settings.bambu) {
                newProject.settings.bambu = {};
              }
              newProject.settings.bambu.topFunction = e.target.value;
              setProject(newProject);
              setProjectModified(true);
            }}
          />
        }
      />
      <SettingsItem
        label={t("flow.bambu.hls.clock_period")}
        component={
          <NumberInput
            placeholder="10"
            defaultValue={project?.settings.bambu?.clockPeriod || 10}
            min={1}
            max={1000}
            onChange={(value) => {
              var newProject = project!;
              if (!newProject.settings.bambu) {
                newProject.settings.bambu = {};
              }
              newProject.settings.bambu.clockPeriod = Number(value);
              setProject(newProject);
              setProjectModified(true);
            }}
          />
        }
      />
    </>
  );
}

// Run Bambu HLS command
export async function runBambuHLSFlowCommand(project: ProjectInfo) {
  const cppFiles = project?.file_lists
    ?.filter((file) => file.type === "cpp" || file.type === "c")
    .map((file) => file.path);

  if (!cppFiles || cppFiles.length === 0) {
    showFailedNotification({
      title: "Bambu HLS",
      message: "No C/C++ source files found in the project.",
    });
    return undefined;
  }

  const topFunction = project.settings.bambu?.topFunction || "main";
  const clockPeriod = project.settings.bambu?.clockPeriod || 10;
  const projectDir = await getDirOfFile(project.path);

  // Bambu automatically names output based on source file (e.g., foo.cpp -> foo.v)
  // Use sidecar binary (user must place bambu binary in binaries/ folder)
  // --memory-allocation-policy=NO_BRAM avoids generating .mem files
  const command = Command.sidecar("binaries/bambu", [
    "--top-fname=" + topFunction,
    "--clock-period=" + clockPeriod,
    "--memory-allocation-policy=NO_BRAM",
    ...cppFiles,
  ], { cwd: projectDir });

  return command;
}

// Run Bambu Synth command (using Yosys)
export async function runBambuSynthFlowCommand(project: ProjectInfo) {
  const outputFileName = project?.name + "_bambu_" + "syn.edf";
  const tclScript = await resolveResource("resource/yosys/yosys_fde.tcl");
  const simlibFile = await resolveResource("resource/yosys/fdesimlib.v");
  const techmapFile = await resolveResource("resource/yosys/techmap.v");
  const cellsMapFile = await resolveResource("resource/yosys/cells_map.v");

  // Bambu generates Verilog file based on source file name (e.g., foo.cpp -> foo.v)
  // Find the first C/C++ source file and derive the HLS output name
  const cppFile = project.file_lists?.find(
    (file) => file.type === "cpp" || file.type === "c"
  );
  if (!cppFile) {
    showFailedNotification({
      title: "Bambu Synth",
      message: "No C/C++ source files found in the project.",
    });
    return undefined;
  }

  // Get basename without extension and add .v
  const baseName = cppFile.name.replace(/\.(cpp|cc|cxx|c)$/i, "");
  const inputFile = baseName + ".v";
  const projectDir = await getDirOfFile(project.path);

  const tclLine =
    "tcl " +
    tclScript +
    " -l " +
    simlibFile +
    " -m " +
    techmapFile +
    " -c " +
    cellsMapFile +
    " -o " +
    outputFileName;
  const command = Command.sidecar(
    "binaries/yosys",
    ["-p", tclLine, projectDir + inputFile],
    { cwd: projectDir }
  );
  return command;
}

// Run Bambu Map command
export async function runBambuMapFlowCommand(project: ProjectInfo) {
  const celllibfilePath = await resolveResource("resource/hw_lib/dc_cell.xml");

  const inputFileName = project?.name + "_bambu_" + "syn.edf";
  const outputFileName = project?.name + "_bambu_" + "map.xml";

  const command = Command.sidecar(
    "binaries/fde-cli/map",
    [
      "-y",
      "-i",
      inputFileName,
      "-o",
      outputFileName,
      "-c",
      celllibfilePath,
      "-e",
    ],
    { cwd: await getDirOfFile(project.path) }
  );

  return command;
}

// Run Bambu Pack command
export async function runBambuPackFlowCommand(project: ProjectInfo) {
  const family = "fdp3";
  const celllibfilePath = await resolveResource(
    "resource/hw_lib/fdp3_cell.xml"
  );
  const plibfilePath = await resolveResource(
    "resource/hw_lib/fdp3_dcplib.xml"
  );
  const xdlcfgfilePath = await resolveResource(
    "resource/hw_lib/fdp3_config.xml"
  );

  const inputFileName = project.name + "_bambu_" + "map.xml";
  const outputFileName = project.name + "_bambu_" + "pack.xml";

  const command = Command.sidecar(
    "binaries/fde-cli/pack",
    [
      "-c",
      family,
      "-n",
      inputFileName,
      "-l",
      celllibfilePath,
      "-r",
      plibfilePath,
      "-o",
      outputFileName,
      "-g",
      xdlcfgfilePath,
      "-e",
    ],
    { cwd: await getDirOfFile(project.path) }
  );

  return command;
}

// Helper function to parse HLS-generated Verilog and extract top module ports
async function parseHLSVerilogPorts(verilogPath: string, topFunctionName: string): Promise<{
  moduleName: string;
  ports: { name: string; direction: "input" | "output"; msb: number; lsb: number }[];
} | null> {
  try {
    const content = await readTextFile(verilogPath);

    // Find the top module (mangled C++ function name pattern: _Z followed by length and name)
    const moduleRegex = /module\s+(_Z\d+\w+)\s*\(([\s\S]*?)\);([\s\S]*?)endmodule/g;
    let match;

    while ((match = moduleRegex.exec(content)) !== null) {
      const moduleName = match[1];
      const moduleBody = match[3];

      // Check if this module name contains the top function name
      if (moduleName.toLowerCase().includes(topFunctionName.toLowerCase())) {
        const ports: { name: string; direction: "input" | "output"; msb: number; lsb: number }[] = [];

        // Parse input/output declarations with optional bit width
        // Matches: input [7:0] a; or input clock;
        const portRegex = /(input|output)\s+(?:\[(\d+):(\d+)\]\s+)?(\w+)\s*;/g;

        let portMatch;
        while ((portMatch = portRegex.exec(moduleBody)) !== null) {
          const direction = portMatch[1] as "input" | "output";
          const msb = portMatch[2] !== undefined ? parseInt(portMatch[2]) : 0;
          const lsb = portMatch[3] !== undefined ? parseInt(portMatch[3]) : 0;
          ports.push({ name: portMatch[4], direction, msb, lsb });
        }

        return { moduleName, ports };
      }
    }

    return null;
  } catch (error) {
    console.error("Failed to parse HLS Verilog:", error);
    return null;
  }
}

// Auto-generate constraint file for Bambu HLS designs
async function generateBambuConstraintFile(project: ProjectInfo): Promise<string | null> {
  const projectDir = await getDirOfFile(project.path);
  const constraintFileName = project.name + "_bambu_cons.xml";
  const constraintFilePath = projectDir + constraintFileName;

  // Check if constraint file already exists
  if (await exists(constraintFilePath)) {
    return constraintFilePath;
  }

  // Find the HLS-generated Verilog file
  const cppFile = project.file_lists?.find(
    (file) => file.type === "cpp" || file.type === "c"
  );
  if (!cppFile) {
    return null;
  }

  const baseName = cppFile.name.replace(/\.(cpp|cc|cxx|c)$/i, "");
  const verilogPath = projectDir + baseName + ".v";

  if (!(await exists(verilogPath))) {
    showFailedNotification({
      title: "Constraint Generation",
      message: "HLS-generated Verilog file not found: " + baseName + ".v",
    });
    return null;
  }

  const topFunction = project.settings.bambu?.topFunction || "main";
  const parseResult = await parseHLSVerilogPorts(verilogPath, topFunction);

  if (!parseResult) {
    showFailedNotification({
      title: "Constraint Generation",
      message: "Could not find top module in HLS-generated Verilog.",
    });
    return null;
  }

  const { moduleName, ports } = parseResult;

  const inputPins = devicePorts.FDP3P7.input;
  const outputPins = devicePorts.FDP3P7.output;
  let inputIdx = 0;
  let outputIdx = 0;

  const portConstraints: string[] = [];

  const assignPin = (portName: string, direction: "input" | "output"): string | null => {
    if (direction === "input") {
      if (inputIdx >= inputPins.length) return null;
      return inputPins[inputIdx++];
    } else {
      if (outputIdx >= outputPins.length) return null;
      return outputPins[outputIdx++];
    }
  };

  for (const port of ports) {
    // Skip clock port - it uses global clock network, not IOB
    if (port.name === "clock") {
      continue;
    }

    const isBus = port.msb !== port.lsb;

    if (isBus) {
      // Expand bus ports: [7:0] -> [0], [1], ..., [7]
      const low = Math.min(port.msb, port.lsb);
      const high = Math.max(port.msb, port.lsb);
      for (let i = low; i <= high; i++) {
        const pin = assignPin(`${port.name}[${i}]`, port.direction);
        if (!pin) {
          showFailedNotification({
            title: "Constraint Generation",
            message: `Not enough ${port.direction} pins for the design.`,
          });
          return null;
        }
        portConstraints.push(`  <port name="${port.name}[${i}]" position="${pin}"/>`);
      }
    } else {
      const pin = assignPin(port.name, port.direction);
      if (!pin) {
        showFailedNotification({
          title: "Constraint Generation",
          message: `Not enough ${port.direction} pins for the design.`,
        });
        return null;
      }
      portConstraints.push(`  <port name="${port.name}" position="${pin}"/>`);
    }
  }

  const xmlContent = `<design name="${moduleName}">
${portConstraints.join("\n")}
</design>`;

  await writeTextFile(constraintFilePath, xmlContent);

  return constraintFilePath;
}

// Place Settings Page
export function BambuPlaceFlowSettingsPage() {
  const { t } = useTranslation();
  const projectContext = useContext(ProjectContext);
  const { project, setProject, setProjectModified } = projectContext;

  return (
    <>
      <SettingsItem
        label={t("flow.mode")}
        component={
          <SegmentedControl
            data={["Timing Driven", "Bounding Box"]}
            onChange={(value) => {
              var newProject = project!;
              newProject.settings.place.mode = value as
                | "Timing Driven"
                | "Bounding Box";
              setProject(newProject);
              setProjectModified(true);
            }}
            defaultValue={project?.settings.place.mode}
          />
        }
      />
    </>
  );
}

// Run Bambu Place command
export async function runBambuPlaceFlowCommand(project: ProjectInfo) {
  const archfilePath = await resolveResource("resource/hw_lib/fdp3p7_arch.xml");
  const plcdelayfilePath = await resolveResource(
    "resource/hw_lib/fdp3p7_dly.xml"
  );

  // Check for existing constraint file or auto-generate one
  let placecstFilePath = project.file_lists.filter(
    (file) => file.type === "constraint"
  )[0]?.path;

  if (!placecstFilePath) {
    // Auto-generate constraint file for Bambu HLS designs
    placecstFilePath = await generateBambuConstraintFile(project);
    if (!placecstFilePath) {
      showFailedNotification({
        title: "Place",
        message: "Failed to generate constraint file. Please add a constraint file manually.",
      });
      return undefined;
    }
  }

  const getPlaceMode = () => {
    if (project.settings.place.mode === "Bounding Box") {
      return "-b";
    } else {
      return "-t";
    }
  };
  const placeMode = getPlaceMode();

  const inputFileName = project.name + "_bambu_" + "pack.xml";
  const outputFileName = project.name + "_bambu_" + "place.xml";

  const command = Command.sidecar(
    "binaries/fde-cli/place",
    [
      "-a",
      archfilePath,
      "-d",
      plcdelayfilePath,
      "-i",
      inputFileName,
      "-o",
      outputFileName,
      "-c",
      placecstFilePath,
      placeMode,
      "-e",
    ],
    { cwd: await getDirOfFile(project.path) }
  );

  return command;
}

// Route Settings Page
export function BambuRouteFlowSettingsPage() {
  function ModeSettingItem() {
    const combobox = useCombobox({
      onDropdownClose: () => combobox.resetSelectedOption(),
    });

    const projectContext = useContext(ProjectContext);
    const { project, setProject, setProjectModified } = projectContext;

    const modes = ["Direct Search", "Breath First", "Timing Driven"];
    const options = modes.map((mode) => (
      <Combobox.Option key={mode} value={mode}>
        {mode}
      </Combobox.Option>
    ));

    return (
      <Combobox
        onOptionSubmit={(value) => {
          const newValue = value as
            | "Direct Search"
            | "Breath First"
            | "Timing Driven";
          var newProject = project!;
          newProject.settings.route.mode = newValue;
          setProject(newProject);
          setProjectModified(true);
          combobox.closeDropdown();
        }}
        store={combobox}
      >
        <Combobox.Target>
          <InputBase
            component="button"
            type="button"
            rightSection={<TbChevronDown size={20} />}
            rightSectionPointerEvents="none"
            pointer
            onClick={() => combobox.toggleDropdown()}
          >
            {project?.settings.route.mode}
          </InputBase>
        </Combobox.Target>
        <Combobox.Dropdown>
          <Combobox.Options>{options}</Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>
    );
  }

  return (
    <>
      <SettingsItem label="Mode" component={<ModeSettingItem />} />
    </>
  );
}

// Run Bambu Route command
export async function runBambuRouteFlowCommand(project: ProjectInfo) {
  const archfilePath = await resolveResource("resource/hw_lib/fdp3p7_arch.xml");
  const getRouteMode = () => {
    if (project.settings.route.mode === "Direct Search") {
      return "-d";
    } else if (project.settings.route.mode === "Breath First") {
      return "-b";
    } else {
      return "-t";
    }
  };
  const routeMode = getRouteMode();

  // Check for existing constraint file or use auto-generated one
  let routecstFilePath = project.file_lists.filter(
    (file) => file.type === "constraint"
  )[0]?.path;

  if (!routecstFilePath) {
    // Try to use the auto-generated constraint file
    const projectDir = await getDirOfFile(project.path);
    const autoConstraintPath = projectDir + project.name + "_bambu_cons.xml";
    if (await exists(autoConstraintPath)) {
      routecstFilePath = autoConstraintPath;
    } else {
      showFailedNotification({
        title: "Route",
        message: "Constraint file not found.",
      });
      return undefined;
    }
  }

  const inputFileName = project.name + "_bambu_" + "place.xml";
  const outputFileName = project.name + "_bambu_" + "route.xml";

  const command = Command.sidecar(
    "binaries/fde-cli/route",
    [
      "-a",
      archfilePath,
      "-n",
      inputFileName,
      "-o",
      outputFileName,
      routeMode,
      "-c",
      routecstFilePath,
      "-e",
    ],
    { cwd: await getDirOfFile(project.path) }
  );

  return command;
}

// Run Bambu GenBit command
export async function runBambuGenBitFlowCommand(project: ProjectInfo) {
  const archfilePath = await resolveResource("resource/hw_lib/fdp3p7_arch.xml");
  const cilfilePath = await resolveResource("resource/hw_lib/fdp3p7_cil.xml");

  const inputFileName = project.name + "_bambu_" + "route.xml";
  const outputFileName = project.name + "_bambu_" + "bit.bit";

  const command = Command.sidecar(
    "binaries/fde-cli/bitgen",
    [
      "-a",
      archfilePath,
      "-c",
      cilfilePath,
      "-n",
      inputFileName,
      "-b",
      outputFileName,
      "-e",
    ],
    { cwd: await getDirOfFile(project.path) }
  );

  return command;
}

// Download Bit Action Component
function BambuDownloadBitAction() {
  const { project } = useContext(ProjectContext);

  if (!project || !project.path) {
    return null;
  }

  const { t } = useTranslation();

  const downloadBitFile = async () => {
    if (project) {
      const bitFile =
        (await getDirOfFile(project.path)) +
        project.name +
        "_bambu_" +
        "bit.bit";

      invoke("program_fpga", { bitfile: bitFile }).then(
        () => {
          showSuccessNotification({
            title: t("program.success"),
            message: bitFile,
          });
        },
        (err) => {
          showFailedNotification({
            title: t("program.failed"),
            message: t("program.error." + err),
          });
        }
      );
    }
  };

  return (
    <Tooltip label={t("program.program")}>
      <ActionIcon
        size="md"
        variant="subtle"
        onClick={downloadBitFile}
        style={{ padding: "5px" }}
      >
        <TbArrowAutofitDown size={20} />
      </ActionIcon>
    </Tooltip>
  );
}

// Export Bambu flows
export const bambuFlows = [
  {
    name: "bambu.hls",
    // Note: Bambu generates output file based on source file name, not project name
    // So we don't specify target_file here
    runFunc: runBambuHLSFlowCommand,
    settingsPage: <BambuHLSSettingsPage />,
  },
  {
    name: "bambu.synth",
    target_file: "bambu_syn.edf",
    runFunc: runBambuSynthFlowCommand,
  },
  {
    name: "bambu.map",
    target_file: "bambu_map.xml",
    runFunc: runBambuMapFlowCommand,
  },
  {
    name: "bambu.pack",
    target_file: "bambu_pack.xml",
    runFunc: runBambuPackFlowCommand,
  },
  {
    name: "bambu.place",
    target_file: "bambu_place.xml",
    runFunc: runBambuPlaceFlowCommand,
    settingsPage: <BambuPlaceFlowSettingsPage />,
  },
  {
    name: "bambu.route",
    target_file: "bambu_route.xml",
    runFunc: runBambuRouteFlowCommand,
    settingsPage: <BambuRouteFlowSettingsPage />,
  },
  {
    name: "bambu.genbit",
    target_file: "bambu_bit.bit",
    runFunc: runBambuGenBitFlowCommand,
    extraActions: <BambuDownloadBitAction />,
  },
];
