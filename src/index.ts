import joplin from 'api';
import { ToolbarButtonLocation } from 'api/types';
import _ = require('lodash');

const getId = (item: any) => {
  return item.ids || item.id
}

/*
  * TODO: convert from arrays to object id based lookup
  * TODO: use lodash templating
  * TODO: intentionally choose which notebook it goes in
  * TODO: handle large note lists with pagination?
  * TODO: allow different review intervals, daily, weekly, monthly, yearly
  * TODO: automatically create these notes
  * TODO: make note creation idempotent and upsert oriented vs duplicative
*/
joplin.plugins.register({
  onStart: async function () {
    joplin.commands.register({
      name: 'dayReview',
      label: 'Makes a review of the note edited today',
      iconName: 'fas fa-clipboard-list',
      execute: async () => {
        // TODO: convert this to only getting X new notes. We probably need to paginate until we're past the updated ones?
        // Or can we be lazy and enumerate all notes?
        // TODO: paginate on has_more
        /*
        {
            "items": [
              {
                  "id": "4d0026f8e9b8483f998f40a5f8935029",
                  "title": "4. Tips on Friday",
                  "created_time": 1640675919427,
                  "updated_time": 1640742947105,
                  "is_todo": 0,
                  "todo_completed": 0
              },
              {
                  "id": "bb32e04fd4794e43901154b58e9df1d1",
                  "title": "2. Importing due at 8pm Monday",
                  "created_time": 1640675919442,
                  "updated_time": 1640716377997,
                  "is_todo": 0,
                  "todo_completed": 0
              }
          ],
          "has_more": false
        }
        */
        const options = {
          fields: ['id', 'title', 'created_time', 'updated_time', 'is_todo', 'todo_completed'],
          order_by: 'updated_time', order_dir: 'DESC'
        }
        const notes = await joplin.data.get(['notes'], options);
        console.info("Notes: ", notes)

        const items = notes.items.reduce((acc, i) => { acc[getId(i)] = i; return acc }, {})
        console.info("items: ", items)

        const CREATED_NOTES = 'CREATED_NOTES'
        const UPDATED_NOTES = 'UPDATED_NOTES'
        const CREATED_TODOS = 'CREATED_TODOS'
        const COMPLETED_TODOS = 'COMPLETED_TODOS'
        var categorizedNotes = {}
        categorizedNotes[CREATED_NOTES] = []
        categorizedNotes[UPDATED_NOTES] = []
        categorizedNotes[CREATED_TODOS] = []
        categorizedNotes[COMPLETED_TODOS] = []

        var date1 = new Date();
        date1.setHours(0, 0, 0);
        var date = date1.getTime();

        console.log("notes ", notes, date1, date1.getTime());

        _.each(items, (item, id) => {
          console.info("forEach: item: ", item, id)
          if (item.created_time >= date) {
            if (item.is_todo) {
              categorizedNotes[CREATED_TODOS].push(item.id)
            } else {
              categorizedNotes[CREATED_NOTES].push(item.id)
            }
          } else if (item.updated_time >= date && !item.is_todo) {
            // "else if" so we don't put the created notes also in the "updated" section
            categorizedNotes[UPDATED_NOTES].push(getId(item))
          }
          if (item.is_todo && item.todo_completed >= date) {
            categorizedNotes[COMPLETED_TODOS].push(getId(item))
          }
        });

        var body = "(Generated automatically)\n\n";
        // TODO : make links using lodash template
        body += createLinksSection("Created Notes", categorizedNotes[CREATED_NOTES], items)
        body += createLinksSection("Updated Notes", categorizedNotes[UPDATED_NOTES], items)
        body += createLinksSection("Created Todos", categorizedNotes[CREATED_TODOS], items)
        body += createLinksSection("Completed Todos", categorizedNotes[COMPLETED_TODOS], items)

        console.info(body);
        date1.setHours(12, 0, 0);
        const title = date1.toISOString().substring(0, 10) + " Review";
        await joplin.data.post(['notes'], null, { body: body, title: title });
      },
    });

    joplin.views.toolbarButtons.create('dayReview', 'dayReview', ToolbarButtonLocation.EditorToolbar);
  },
});

const createLinkForItem = (item: any) => {
  console.info("createLinkForItem item: ", item)
  const link = "* [" + item.title + "](:/" + item.id + ")\n";
  return link;
}

// TODO: fix types
const createLinksSection = (title: string, ids: any, items: any) => {
  let output = `# ${title}\n`;
  console.info("createLinksSection ids: ", ids)

  _.each(ids, (id) => {
    console.info("createLinksSection id: ", id)
    let item = items[id];
    if (!item) {
      console.error("unable to find item by id: ", id)
      throw Error("broken id lookup");
    }
    output += createLinkForItem(item);
  })
  return output;
}
