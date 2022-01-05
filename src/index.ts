import joplin from "api";
import * as crypto from "crypto";
import { ToolbarButtonLocation } from "api/types";
import _ = require("lodash");
import {
  format,
  subDays,
  addMonths,
  subMonths,
  subYears,
  subWeeks,
  addYears,
  addDays,
} from "date-fns";

const CREATED_NOTES = "CREATED_NOTES";
const UPDATED_NOTES = "UPDATED_NOTES";
const CREATED_TODOS = "CREATED_TODOS";
const COMPLETED_TODOS = "COMPLETED_TODOS";

const DAILY_REVIEW = "DAILY_REVIEW";
const PRIOR_DAILY_REVIEW = "PRIOR_DAILY_REVIEW";
const WEEKLY_REVIEW = "WEEKLY_REVIEW";
const PRIOR_WEEKLY_REVIEW = "PRIOR_WEEKLY_REVIEW";
const MONTHLY_REVIEW = "MONTHLY_REVIEW";
const PRIOR_MONTHLY_REVIEW = "PRIOR_MONTHLY_REVIEW";
const YEARLY_REVIEW = "YEARLY_REVIEW";
const PRIOR_YEARLY_REVIEW = "PRIOR_YEARLY_REVIEW";

// TODO: make these dateFn have a matching upper bound since queries are "since..."
// readableDateFn is the human readable form
const reviewTypes = {
  [DAILY_REVIEW]: {
    unit: "day-0",
    readableDateFn: () => format(new Date(), "yyyy-MM-dd"),
    dateFn: () => format(new Date(), "yyyyMMdd"),
    upperDateFn: () => format(addDays(new Date(), 1), "yyyyMMdd"),
  },
  [PRIOR_DAILY_REVIEW]: {
    unit: "day-1",
    readableDateFn: () => format(subDays(new Date(), 1), "yyyy-MM-dd"),
    dateFn: () => format(subDays(new Date(), 1), "yyyyMMdd"),
    upperDateFn: () => format(new Date(), "yyyyMMdd"),
  },
  [WEEKLY_REVIEW]: {
    // TODO: weeklies are probably broken right now, need to round to Sun/Mon
    unit: "days-7",
    readableDateFn: () => format(new Date(), "yyyy '#'ww"),
    dateFn: () => format(subDays(new Date(), 7), "yyyyMMdd"),
    upperDateFn: () => format(subDays(new Date(), 0), "yyyyMMdd"),
  },
  [PRIOR_WEEKLY_REVIEW]: {
    // TODO: weeklies are probably broken right now, need to round to Sun/Mon
    unit: "days-14",
    readableDateFn: () => format(subWeeks(new Date(), 1), "yyyy '#'ww"),
    dateFn: () => format(subDays(new Date(), 14), "yyyyMMdd"),
    upperDateFn: () => format(subDays(new Date(), 7), "yyyyMMdd"),
  },
  [MONTHLY_REVIEW]: {
    unit: "month-0",
    readableDateFn: () => format(new Date(), "yyyy-MM"),
    dateFn: () => format(new Date(), "yyyyMM"),
    upperDateFn: () => format(addMonths(new Date(), 1), "yyyyMM"),
  },
  [PRIOR_MONTHLY_REVIEW]: {
    unit: "month-1",
    readableDateFn: () => format(subMonths(new Date(), 1), "yyyy-MM"),
    dateFn: () => format(subMonths(new Date(), 1), "yyyyMM"),
    upperDateFn: () => format(new Date(), "yyyyMM"),
  },
  [YEARLY_REVIEW]: {
    unit: "year-0",
    readableDateFn: () => format(new Date(), "yyyy"),
    dateFn: () => format(new Date(), "yyyy"),
    upperDateFn: () => format(addYears(new Date(), 1), "yyyy"),
  },
  [PRIOR_YEARLY_REVIEW]: {
    unit: "year-1",
    readableDateFn: () => format(subYears(new Date(), 1), "yyyy"),
    dateFn: () => format(subYears(new Date(), 1), "yyyy"),
    upperDateFn: () => format(new Date(), "yyyy"),
  },
};

const DEFAULT_FIELDS = [
  "id",
  "title",
  "created_time",
  "updated_time",
  "is_todo",
  "todo_completed",
];
const DEFAULT_OPTIONS = {
  fields: DEFAULT_FIELDS,
  order_by: "updated_time",
  order_dir: "DESC",
};

const getId = (item: any) => {
  return item.ids || item.id;
};

const baseReview = async (type) => {
  var date = new Date();

  //const items = await getNotes()
  const categorizedNotes = await categorizeNotes(date, type);
  const { dateStamp, hash } = generateHash(date, type);
  const body = buildReviewNote(categorizedNotes, hash, type);
  // TODO: make this adjust to different types of REVIEW_TYPES, ie 2022 for year, 2021-01 for monthly etc
  const { readableDateFn } = reviewTypes[type];
  const title = `${readableDateFn()} ${_.chain(type)
    .replace("PRIOR_", "")
    .lowerCase()
    .startCase()}`;
  upsertReviewNote(hash, _.join(body, "\n"), title);
};

const getNotes = async () => {
  const items = await getAllData(["notes"], DEFAULT_OPTIONS);
  console.debug("Notes: ", items);
  return convertItemsToMap(items);
};

const convertItemsToMap = (items) =>
  items.reduce((acc, i) => {
    acc[getId(i)] = i;
    return acc;
  }, {});

const getNotesWithSearch = async (searchOptions) => {
  //{ query: hash, type: "note"}
  // TODO: paginate
  const args = { ...DEFAULT_OPTIONS, ...searchOptions };
  console.info("getNotesWithSearch", args);
  const result = await getAllData(["search"], args);
  console.info("getNotesWithSearch result:", result);
  return convertItemsToMap(result);
};

const getAllData = async (arg1, options) => {
  let notes = [];
  let has_more = true;
  let page = 0;
  while (has_more) {
    page += 1;
    const result = await joplin.data.get(arg1, { ...options, ...{ page } });
    console.info("getAllData", result);
    has_more = result.has_more;
    let items = result.items;
    notes = [...notes, ...items];
  }
  return notes;
};

// TODO: convert this to allow for creating prior month or future month or prior year
const categorizeNotes = async (_date, reviewType) => {
  // NOTE: type:todo appears to be invalid and not a proper `type` so working around it via type:note + istodo
  var categorizedNotes = {};
  // https://joplinapp.org/help/#searching
  // Must be string format of k:v formatting
  // TODO: fix this horrible hack that ensures upper bound
  const { dateFn, upperDateFn } = reviewTypes[reviewType];
  const created = [`created:${dateFn()} -created:${upperDateFn()}`];
  const updated = [`updated:${dateFn()} -updated:${upperDateFn()}`];
  // Use iscompleted and updated as a proxy for what we really want to query which is "todo_completed"
  const completed = ["iscompleted:1"];
  const anyType = ["any:0"];
  categorizedNotes[CREATED_NOTES] = await getNotesWithSearch({
    query: ["type:note", ...anyType, ...created].join(" "),
  });
  categorizedNotes[CREATED_TODOS] = await getNotesWithSearch({
    query: ["type:todo", ...anyType, ...created].join(" "),
  });
  categorizedNotes[UPDATED_NOTES] = await getNotesWithSearch({
    query: ["type:note", ...anyType, ...updated].join(" "),
  });
  categorizedNotes[COMPLETED_TODOS] = await getNotesWithSearch({
    query: ["type:todo", ...anyType, ...completed, ...updated].join(" "),
  });

  console.info("categorizeNotes", categorizedNotes);
  return categorizedNotes;
};
const generateHash = (date, type) => {
  date.setHours(12, 0, 0);
  const dateStamp = date.toISOString().substring(0, 10);
  const toHash = `${dateStamp}:${type}`;
  const hash = crypto.createHash("md5").update(toHash).digest("hex");
  return { dateStamp, hash };
};

const SPACER = "\n\n";
const CODE_BACKTICKS = "```";
const buildReviewNote = (categorizedNotes, hash, type) => {
  console.info("buildReviewNote: start", categorizedNotes);
  var body = _.flattenDeep([
    "(Auto Generated by Day Review Plugin)\n",
    createLinksSection("Created Notes", categorizedNotes[CREATED_NOTES]),
    SPACER,
    createLinksSection("Updated Notes", categorizedNotes[UPDATED_NOTES]),
    SPACER,
    createLinksSection("Created Todos", categorizedNotes[CREATED_TODOS]),
    SPACER,
    createLinksSection("Completed Todos", categorizedNotes[COMPLETED_TODOS]),
    SPACER,
    SPACER,
    SPACER,
    `${CODE_BACKTICKS}\n${JSON.stringify({
      reviewMetadata: true,
      reviewId: hash,
      reviewType: type,
    })}\n${CODE_BACKTICKS}`,
  ]);
  console.debug("unjoined body", body);
  return body;
};

const upsertReviewNote = async (hash: string, body: string, title: string) => {
  console.info("body: ", body);
  console.info("trying to get maybeNote: ", hash);
  const itemsSearch = await joplin.data.get(["search"], {
    query: hash,
    type: "note",
    fields: ["id", "title", "body"],
    page: 1,
  });
  const maybeNote = itemsSearch.items;
  console.info("maybeNote: ", maybeNote);
  const content = { body, title };
  // TODO: make this land in the correct notebook, maybe based on Settings?
  if (maybeNote && maybeNote.length === 1) {
    const reviewId = maybeNote[0].id;
    await joplin.data.put(["notes", reviewId], null, content);
  } else {
    await joplin.data.post(["notes"], null, content);
  }
};

const createLinkForItem = (item: any) => {
  console.info("createLinkForItem item: ", item);
  const link = `* [${item.title}](:/${item.id})`;
  return link;
};

// TODO: fix types
const createLinksSection = (title: string, items: any): string[] => {
  let output = [];
  output.push(`# ${title}\n`);

  _.each(items, (v, k) => {
    console.info("createLinksSection id: ", k);
    let item = v;
    if (!item) {
      console.error("unable to find item by id: ", k);
      throw Error("broken id lookup");
    }
    output.push(createLinkForItem(item));
  });
  return output;
};

/*
 * TODO: intentionally choose which notebook it goes in
 * TODO: automatically create these notes in correct notebook, separate notebook for automated notes
 */
joplin.plugins.register({
  onStart: async function () {
    _.each(reviewTypes, (_v, k) => {
      registerReview(k);
    });

    const all = "allReviews";
    joplin.commands.register({
      name: all,
      label: `Runs all review generations`,
      iconName: "fas fa-clipboard-list",
      execute: allReviews,
    });

    joplin.workspace.onNoteChange(async (event: any) => {
      await debouncedAllReviews();
    });

    joplin.views.toolbarButtons.create(
      all,
      all,
      ToolbarButtonLocation.EditorToolbar
    );
  },
});

const allReviews = async () => {
  _.each(reviewTypes, (_v, k) => {
    baseReview(k);
  });
};
const debouncedAllReviews = _.debounce(allReviews, 5000);

const registerReview = (type) => {
  const name = _.camelCase(type);
  joplin.commands.register({
    name: name,
    label: `Creates a ${_.chain(type)
      .lowerCase()
      .startCase()} of the notes edited`,
    iconName: "fas fa-clipboard-list",
    execute: async () => baseReview(type),
  });

  joplin.views.toolbarButtons.create(
    name,
    name,
    ToolbarButtonLocation.EditorToolbar
  );
};
