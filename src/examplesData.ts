import { PreloadedExample } from "./types";

export const PRELOADED_EXAMPLES: PreloadedExample[] = [
  {
    id: "slide-unlock",
    name: "Apple 'Slide to Unlock' Patent (US 7,590,485)",
    claimNumber: "Claim 1",
    claimText: `A computer-implemented method, comprising:
at a device with a touch-sensitive display:
detecting a contact with the touch-sensitive display;
moving an unlock image along a predefined path on the display in response to the detected contact; and
unlocking the device if the moving of the unlock image matches a predefined gesture.`,
    referenceCitation: "NeonNode N1m User Guide (US 7,020,088)",
    referenceText: `The NeonNode N1m device features a custom touch-sensitive panel utilizing infrared light beams across the screen. 
To unlock the device keypad and prevent accidental key presses, the user guide teaches executing a sweeping sweeping gesture. 
Specifically, the system detects a stylus or finger physical contact at the bottom boundary of the screen and monitors movement. 
When the user sweeps horizontally across the designated bottom sweep line, the keypad controller transforms from locked to unlocked mode. 
A tiny progress bar at the bottom reflects the sweep gesture sequence, but there is no graphic unlock image icon that is dragged along a predefined path. Unlocking is strictly based on coordinate-based threshold swipe swipe detection.`,
    relevantSections: "Section 3.2: Keypad Lock and Gestures (Page 14, Paragraph 4)"
  },
  {
    id: "data-buffer",
    name: "High-Speed Processor Memory Buffer (US 8,452,900)",
    claimNumber: "Claim 1",
    claimText: `A data processing system comprising:
a memory buffer; and
a processor configured to execute instructions;
wherein the processor is a multi-core processor; and
wherein the memory buffer is a DRAM module.`,
    referenceCitation: "Smith '123 Computer Architecture, Vol. 4",
    referenceText: `Smith discloses a modular computer processor architecture designed for handling network communication packets. 
The system utilizes a dedicated hardware storage unit (element 204) configured to temporarily hold the incoming and outgoing data packets to prevent data loss. 
This packet storage buffer (204) is implemented using high-speed dynamic random-access memory (DRAM) chips on a mother board. 
A central processing unit (CPU module 102) is connected to the buffer via a system bus and executes software algorithms to parse headers. 
[Note: Throughout the paper, CPU 102 is consistently illustrated and described as a legacy single-threaded sequential processor. No mention of multi-core, parallel processor cores, or symmetric multiprocessing is found anywhere in the disclosures.]`,
    relevantSections: "Page 4, Column 2, Line 15 to Column 3, Line 12"
  },
  {
    id: "irrigation-system",
    name: "Automated Smart Irrigation Controller (US 9,123,456)",
    claimNumber: "Claim 14",
    claimText: `An automated irrigation system comprising:
a water control valve;
a ground moisture sensor reporting local hydration levels;
a network interface connected to a remote weather forecasting server; and
a microcontroller configured to actuate the water control valve based on both the reported soil moisture level and an upcoming rain forecast probability.`,
    referenceCitation: "GreenThumb Irrigation Manual (US 8,881,102)",
    referenceText: `The GreenThumb automated watering controller consists of an electronic water control valve coupled directly to physical sprinkler pipes. 
The control unit is hard-wired to a ground soil moisture sensor buried near root level. 
The buried ground sensor periodically reports local soil hydration levels to the central controller. 
If soil moisture drops below a pre-programmed volumetric water content limit (such as 18%), the microcontroller actuates the solenoid valve to trigger water flow. 
The GreenThumb systems operate 100% locally and do not possess any internet link, Wi-Fi adapter, or external network link. It has no capabilities to fetch weather model information or rain forecasts. It relies exclusively on active soil moisture telemetry.`,
    relevantSections: "Chapter 2: Sensor Wiring and Valve Actuation (Pages 34-36)"
  },
  {
    id: "irrigation-network",
    name: "Remote Forecast Irrigation (US 9,123,456 - Alt)",
    claimNumber: "Claim 14",
    claimText: `An automated irrigation system comprising:
a water control valve;
a ground moisture sensor reporting local hydration levels;
a network interface connected to a remote weather forecasting server; and
a microcontroller configured to actuate the water control valve based on both the reported soil moisture level and an upcoming rain forecast probability.`,
    referenceCitation: "HydroStream Wireless Controller System (US 8,992,341)",
    referenceText: `The HydroStream product represents a smart weather-aware controller for urban parks. 
The controller establishes a Wi-Fi or cellular network interface back to the HydroStream cloud service. 
This cloud service pushes national weather forecast probability metrics directly to the park controller. 
The controller contains software rules to cancel scheduled irrigation cycles if a rain probability threshold exceeds 65% in the next 12 hours. 
The HydroStream controller regulates watering purely using predefined clock calendars and incoming internet weather forecasts. 
Because it is designed for wide area deployment, the system does not include, and cannot read data from, any physical ground soil moisture telemetry or moisture sensors. The user must manually input average soil type estimates into the controller app instead.`,
    relevantSections: "Column 12, Lines 22-89: Forecast API Integrations."
  }
];
