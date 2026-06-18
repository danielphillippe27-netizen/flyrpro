export type IndustryCopy = {
  industryKey: 'generic' | 'roofing';
  nouns: {
    campaign: string;
    campaignPlural: string;
    contact: string;
    contactPlural: string;
    lead: string;
    leadPlural: string;
    appointment: string;
    appointmentPlural: string;
    farm: string;
    farmPlural: string;
  };
  navLabels: Record<string, string>;
  actions: {
    createCampaign: string;
    addContact: string;
    importLeads: string;
    sendToDialer: string;
  };
  home: {
    recentCampaignsTitle: string;
    recentCampaignsEmpty: string;
    recentCampaignsLink: string;
  };
  campaigns: {
    selectTitle: string;
    selectDescription: string;
    searchPlaceholder: string;
    noActive: string;
    noCompleted: string;
    signIn: string;
    unnamed: string;
    deleteTitle: string;
    deleteDescriptionFallback: string;
    createTitle: string;
    createDescription: string;
    nameLabel: string;
    namePlaceholder: string;
    generatingTitle: string;
  };
  leads: {
    pageTitle: string;
    pageDescription: string;
    allListName: string;
    allListDescription: string;
    campaignListDescription: string;
    farmListDescription: string;
    selectedAllDescription: string;
    selectedListDescription: (listName: string) => string;
    totalLabel: string;
    newThisWeekLabel: string;
    conversionRateLabel: string;
    loading: string;
    empty: string;
    selectAllAria: string;
    importedSavedEmptyManage: string;
    importedSavedEmpty: string;
    newSavedListDescription: string;
    listNamePlaceholder: string;
    baseKindLabel: string;
    baseKindPlaceholder: string;
    sourcePlaceholder: string;
    tagsPlaceholder: string;
  };
  contactDialog: {
    title: string;
    description: string;
    secondContact: string;
    addSecondContact: string;
    removeSecondContact: string;
    notesPlaceholder: string;
    sourcePlaceholder: string;
    tagsPlaceholder: string;
    appointmentLabel: string;
    submitSingle: string;
    submitMultiple: string;
    submitting: string;
  };
  importDialog: {
    title: string;
    description: string;
    listNamePlaceholder: string;
    helper: string;
  };
};

const genericCopy: IndustryCopy = {
  industryKey: 'generic',
  nouns: {
    campaign: 'campaign',
    campaignPlural: 'campaigns',
    contact: 'contact',
    contactPlural: 'contacts',
    lead: 'lead',
    leadPlural: 'leads',
    appointment: 'appointment',
    appointmentPlural: 'appointments',
    farm: 'farm',
    farmPlural: 'farms',
  },
  navLabels: {},
  actions: {
    createCampaign: 'Create campaign',
    addContact: 'Add Contact',
    importLeads: 'Import CSV',
    sendToDialer: 'Send to Dialler',
  },
  home: {
    recentCampaignsTitle: 'Recently used campaigns',
    recentCampaignsEmpty: 'No campaigns yet.',
    recentCampaignsLink: 'View all campaigns',
  },
  campaigns: {
    selectTitle: 'Select a campaign',
    selectDescription: 'Choose a campaign from the list or create a new one to get started.',
    searchPlaceholder: 'Search campaigns...',
    noActive: 'No active campaigns',
    noCompleted: 'No completed campaigns',
    signIn: 'Sign in to view campaigns',
    unnamed: 'Unnamed Campaign',
    deleteTitle: 'Delete campaign',
    deleteDescriptionFallback: 'Unnamed Campaign',
    createTitle: 'Name your campaign',
    createDescription: 'Your territory is drawn. Add a name to finish creating this campaign.',
    nameLabel: 'Campaign name',
    namePlaceholder: 'Spring flyer drop',
    generatingTitle: 'Generating Campaign',
  },
  leads: {
    pageTitle: 'Leads',
    pageDescription: 'Manage leads with lists from imports, campaigns, and farms, then send the right group to the dialer.',
    allListName: 'All Leads',
    allListDescription: 'People your team has actually contacted.',
    campaignListDescription: 'Campaign list',
    farmListDescription: 'Farm list',
    selectedAllDescription: 'Browse people your team has talked to. New scraper prospects stay in their saved lists until contacted.',
    selectedListDescription: (listName: string) => `Working from the ${listName} list. Send this group straight to the dialler.`,
    totalLabel: 'Total calls',
    newThisWeekLabel: 'New calls this week',
    conversionRateLabel: 'Connected-call-to-call rate',
    loading: 'Loading leads...',
    empty: 'No leads match your filters.',
    selectAllAria: 'Select all visible leads',
    importedSavedEmptyManage: 'Create a saved list to keep a reusable lead segment handy.',
    importedSavedEmpty: 'Imported and saved lists will show up here.',
    newSavedListDescription: 'Save a reusable lead view when you want to keep a segment around outside of imports, campaigns, or farms.',
    listNamePlaceholder: 'Spring networking follow-up',
    baseKindLabel: 'Base lead type',
    baseKindPlaceholder: 'Choose a lead type',
    sourcePlaceholder: 'Google Maps, referral, open house',
    tagsPlaceholder: 'vip, listing, sphere',
  },
  contactDialog: {
    title: 'Add New Contact',
    description: 'Add a new lead',
    secondContact: '2nd Contact',
    addSecondContact: 'Add 2nd Contact',
    removeSecondContact: 'Remove 2nd Contact',
    notesPlaceholder: 'Additional notes about this contact...',
    sourcePlaceholder: 'Referral, Open house, Website...',
    tagsPlaceholder: 'Buyer, Seller, Investor',
    appointmentLabel: 'Appointment',
    submitSingle: 'Create Contact',
    submitMultiple: 'Create Contacts',
    submitting: 'Creating...',
  },
  importDialog: {
    title: 'Import Leads from CSV',
    description: "Upload a CSV and we'll create leads in this workspace. Common lead headers are mapped automatically.",
    listNamePlaceholder: 'Spring open house import',
    helper: "Optional. We'll create a list from this import so you can filter these leads later.",
  },
};

const roofingCopy: IndustryCopy = {
  ...genericCopy,
  industryKey: 'roofing',
  nouns: {
    campaign: 'roofing campaign',
    campaignPlural: 'roofing campaigns',
    contact: 'homeowner',
    contactPlural: 'homeowners',
    lead: 'roofing inquiry',
    leadPlural: 'roofing inquiries',
    appointment: 'inspection',
    appointmentPlural: 'inspections',
    farm: 'service area',
    farmPlural: 'service areas',
  },
  navLabels: {
    '/farms': 'Service Areas',
    '/leads': 'Inquiries',
    '/appointments': 'Inspections',
    '/calendar': 'Calendar',
  },
  actions: {
    createCampaign: 'Create roofing campaign',
    addContact: 'Add Homeowner',
    importLeads: 'Import CSV',
    sendToDialer: 'Send to Dialler',
  },
  home: {
    recentCampaignsTitle: 'Recently used roofing campaigns',
    recentCampaignsEmpty: 'No roofing campaigns yet.',
    recentCampaignsLink: 'View all campaigns',
  },
  campaigns: {
    selectTitle: 'Select a roofing campaign',
    selectDescription: 'Choose a roofing campaign from the list or create a new one to start booking inspections.',
    searchPlaceholder: 'Search roofing campaigns...',
    noActive: 'No active roofing campaigns',
    noCompleted: 'No completed roofing campaigns',
    signIn: 'Sign in to view roofing campaigns',
    unnamed: 'Unnamed Roofing Campaign',
    deleteTitle: 'Delete roofing campaign',
    deleteDescriptionFallback: 'Unnamed Roofing Campaign',
    createTitle: 'Name your roofing campaign',
    createDescription: 'Your territory is drawn. Add a name to finish creating this roofing campaign.',
    nameLabel: 'Roofing campaign name',
    namePlaceholder: 'Spring roof inspection route',
    generatingTitle: 'Generating Roofing Campaign',
  },
  leads: {
    ...genericCopy.leads,
    pageTitle: 'Roofing inquiries',
    pageDescription: 'Manage homeowner inquiries from imports, roofing campaigns, and service areas, then send the right group to the dialer.',
    allListName: 'All Roofing Inquiries',
    allListDescription: 'Homeowners your team has actually contacted.',
    campaignListDescription: 'Roofing campaign list',
    farmListDescription: 'Service area list',
    selectedAllDescription: 'Browse homeowners your team has talked to. New scraper prospects stay in their saved lists until contacted.',
    selectedListDescription: (listName: string) => `Working from the ${listName} list. Send these homeowners straight to the dialler.`,
    totalLabel: 'Total roofing inquiries',
    newThisWeekLabel: 'New inquiries this week',
    conversionRateLabel: 'Conversation-to-inquiry rate',
    loading: 'Loading roofing inquiries...',
    empty: 'No roofing inquiries match your filters.',
    selectAllAria: 'Select all visible roofing inquiries',
    importedSavedEmptyManage: 'Create a saved list to keep a reusable homeowner segment handy.',
    importedSavedEmpty: 'Imported homeowner lists will show up here.',
    newSavedListDescription: 'Save a reusable inquiry view when you want to keep a segment around outside of imports, roofing campaigns, or service areas.',
    listNamePlaceholder: 'Storm damage follow-up',
    baseKindLabel: 'Base inquiry type',
    baseKindPlaceholder: 'Choose an inquiry type',
    sourcePlaceholder: 'Website, referral, storm damage campaign',
    tagsPlaceholder: 'leak repair, storm damage, gutters',
  },
  contactDialog: {
    title: 'Add New Homeowner',
    description: 'Add a new roofing inquiry',
    secondContact: '2nd Homeowner',
    addSecondContact: 'Add 2nd Homeowner',
    removeSecondContact: 'Remove 2nd Homeowner',
    notesPlaceholder: 'Notes about the roof, leak, storm damage, or follow-up...',
    sourcePlaceholder: 'Referral, website, storm damage campaign...',
    tagsPlaceholder: 'Leak repair, storm damage, gutters',
    appointmentLabel: 'Inspection',
    submitSingle: 'Create Homeowner',
    submitMultiple: 'Create Homeowners',
    submitting: 'Creating...',
  },
  importDialog: {
    title: 'Import Roofing Inquiries from CSV',
    description: "Upload a CSV and we'll create homeowner inquiries in this workspace. Common inquiry headers are mapped automatically.",
    listNamePlaceholder: 'Storm damage inspection list',
    helper: "Optional. We'll create a list from this import so you can filter these homeowners later.",
  },
};

function normalizeIndustry(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function getIndustryCopy(industry: string | null | undefined): IndustryCopy {
  const normalized = normalizeIndustry(industry);
  if (normalized.includes('roof')) return roofingCopy;
  return genericCopy;
}
